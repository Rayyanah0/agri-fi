//! FarmCampaign Soroban Smart Contract
//!
//! Each farming project deploys one instance of this contract.
//! Manages investment acceptance, escrow locking, milestone-based releases,
//! automated revenue distribution, emergency pause, and refunds.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Map, String, Symbol, Vec, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized       = 1,
    AlreadyInitialized   = 2,
    Unauthorized         = 3,
    FundingClosed        = 4,
    TargetExceeded       = 5,
    InsufficientFunds    = 6,
    InvalidAmount        = 7,
    Paused               = 8,
    NotFunded            = 9,
    MilestoneNotFound    = 10,
    MilestoneAlreadyDone = 11,
    RefundNotAllowed     = 12,
    DeadlinePassed       = 13,
    AlreadyDistributed   = 14,
    DisputeActive        = 15,
    NoDispute            = 16,
    InvalidBps           = 17,
    ReleaseCapExceeded   = 18,
    VotingWindowClosed   = 19,
    VotingNotOver        = 20,
    AlreadyVoted         = 21,
    NotAnArbitrator      = 22,
    EvidenceLimitReached = 23,
    EmptyArbitratorPool  = 24,
    DisputeDecided       = 25,
    InvalidEvidence      = 26,
}

#[contracttype]
pub enum DataKey {
    Config,
    State,
    Investments,
    MilestoneReleased(u32),
    Distributed,
    Arbitrator,
    Dispute(u32),
    RefundableInvestments,
    Refunded,
    CloseReason,
    /// Full dispute lifecycle record for a milestone (#1004). `Dispute(u32)`
    /// above stays the live "milestone is frozen" boolean flag that
    /// `has_dispute`/`release_milestone` already read, so instances deployed
    /// before #1004 keep working; this key carries the state machine
    /// (phase, voting window, votes, evidence, outcome) alongside it.
    DisputeRecord(u32),
    ArbitratorPool,
    VotingWindow,
}

/// Arbitrator voting window used when a dispute is opened and no explicit
/// window has been configured with `set_dispute_voting_window`.
const DEFAULT_VOTING_WINDOW_SECS: u64 = 7 * 24 * 60 * 60;

/// Bounds dispute storage: evidence is written on-chain and an unbounded
/// vector would let a dispute grow past the instance storage limit.
const MAX_DISPUTE_EVIDENCE: u32 = 32;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub farmer: Address,
    pub arbitrator: Address,
    pub usdc_token: Address,
    pub funding_target: i128,
    pub deadline: u64,
    pub platform_fee_bps: u32,
    pub milestone_count: u32,
    pub partial_release_cap_bps: u32,
    pub project_name: String,
    pub commodity: String,
    pub max_funding: i128,
}

/// Fee/milestone terms, bundled into one parameter so `initialize`/
/// `initialize_with_max_funding` stay under Soroban's 10-parameter-per-
/// contract-function limit (`#[contractimpl]` rejects an 11th). See the
/// comment on `initialize` for the full history of why this exists.
#[contracttype]
#[derive(Clone)]
pub struct CampaignTerms {
    pub platform_fee_bps: u32,
    pub milestone_count: u32,
    pub partial_release_cap_bps: u32,
}

/// Display-only project metadata, bundled for the same parameter-count
/// reason as `CampaignTerms`.
#[contracttype]
#[derive(Clone)]
pub struct CampaignMetadata {
    pub project_name: String,
    pub commodity: String,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum CampaignStatus {
    Open,
    Funded,
    Active,
    Delivered,
    Completed,
    Failed,
    Paused,
}

#[contracttype]
#[derive(Clone)]
pub struct State {
    pub status: CampaignStatus,
    pub total_raised: i128,
    pub milestones_released: u32,
    pub partial_release_total_bps: u32,
    pub raise_ended: bool,
    /// Cumulative amount already paid out of escrow to the farmer via
    /// `release_milestone`/`partial_release_milestone`. Tracked directly
    /// (rather than re-derived from `milestones_released`/
    /// `partial_release_total_bps` after the fact) so refund safety never
    /// drifts if either release formula changes later. See `mark_failed`.
    pub total_released: i128,
}

/// Lifecycle phase of a milestone dispute (#1004).
///
/// `Open` -> dispute raised, evidence accepted, no verdict yet.
/// `Arbitration` -> at least one arbitrator vote recorded.
/// `Verdict` -> quorum reached or the voting window closed; the outcome is
/// fixed and can only be executed, never re-decided.
/// `Resolved` -> the outcome has been executed.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DisputePhase {
    Open,
    Arbitration,
    Verdict,
    Resolved,
}

/// Executable outcome of a dispute: pay the milestone tranche to the farmer,
/// or make whatever is still in escrow refundable to investors.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DisputeOutcome {
    Release,
    Refund,
}

#[contracttype]
#[derive(Clone)]
pub struct Evidence {
    pub submitter: Address,
    pub uri: String,
    pub submitted_at: u64,
}

/// On-chain dispute record for one milestone.
///
/// The verdict is stored as `Option<bool>` (`true` = release to the farmer,
/// `false` = refund the investors) because Soroban's struct serialization only
/// supports `Option` of primitive values, not of a `contracttype` enum.
/// `Dispute::outcome` hands it back as the `DisputeOutcome` the API uses.
#[contracttype]
#[derive(Clone)]
pub struct Dispute {
    pub milestone_index: u32,
    pub raised_by: Address,
    pub opened_at: u64,
    /// Last ledger timestamp at which a vote still counts.
    pub voting_deadline: u64,
    pub phase: DisputePhase,
    pub release_votes: u32,
    pub refund_votes: u32,
    pub voters: Vec<Address>,
    pub evidence: Vec<Evidence>,
    pub verdict: Option<bool>,
}

impl Dispute {
    pub fn outcome(&self) -> Option<DisputeOutcome> {
        self.verdict.map(FarmCampaignContract::outcome_of)
    }
}

#[contract]
pub struct FarmCampaignContract;
#[contractimpl]
impl FarmCampaignContract {

    /// Initializes with `max_funding` defaulted to `funding_target` (no
    /// headroom above target — see `initialize_with_max_funding` to set a
    /// cap above target). `terms`/`metadata` are bundled structs, not a
    /// flat parameter list: Soroban's `#[contractimpl]` caps a contract
    /// function at 10 parameters, and this constructor's inputs (admin,
    /// farmer, arbitrator, usdc_token, funding_target, deadline, plus fee/
    /// milestone/release-cap terms and project display metadata) exceed
    /// that as separate arguments.
    pub fn initialize(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        deadline: u64,
        terms: CampaignTerms,
        metadata: CampaignMetadata,
    ) -> Result<(), Error> {
        Self::initialize_internal(
            env,
            admin,
            farmer,
            arbitrator,
            usdc_token,
            funding_target,
            funding_target,
            deadline,
            terms,
            metadata,
        )
    }

    /// Same as `initialize`, but with an explicit `max_funding` cap above
    /// `funding_target` (see `CampaignTerms`/`CampaignMetadata`'s doc on
    /// `initialize` for why those two are bundled structs).
    pub fn initialize_with_max_funding(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        max_funding: i128,
        deadline: u64,
        terms: CampaignTerms,
        metadata: CampaignMetadata,
    ) -> Result<(), Error> {
        Self::initialize_internal(
            env,
            admin,
            farmer,
            arbitrator,
            usdc_token,
            funding_target,
            max_funding,
            deadline,
            terms,
            metadata,
        )
    }

    fn initialize_internal(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        max_funding: i128,
        deadline: u64,
        terms: CampaignTerms,
        metadata: CampaignMetadata,
    ) -> Result<(), Error> {
        let CampaignTerms { platform_fee_bps, milestone_count, partial_release_cap_bps } = terms;
        let CampaignMetadata { project_name, commodity } = metadata;
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if funding_target <= 0
            || max_funding <= 0
            || max_funding < funding_target
        {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::DeadlinePassed);
        }
        if platform_fee_bps > 10_000 {
            return Err(Error::InvalidBps);
        }
        if partial_release_cap_bps == 0 || partial_release_cap_bps > 10_000 {
            return Err(Error::InvalidBps);
        }
        let config = Config {
            admin,
            farmer,
            arbitrator: arbitrator.clone(),
            usdc_token,
            funding_target,
            deadline,
            platform_fee_bps,
            milestone_count,
            partial_release_cap_bps,
            project_name,
            commodity,
            max_funding,
        };
        let state = State {
            status: CampaignStatus::Open,
            total_raised: 0,
            milestones_released: 0,
            partial_release_total_bps: 0,
            raise_ended: false,
            total_released: 0,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::Investments, &Map::<Address, i128>::new(&env));
        env.storage().instance().set(
            &DataKey::RefundableInvestments,
            &Map::<Address, i128>::new(&env),
        );
        env.storage().instance().set(&DataKey::Refunded, &Map::<Address, bool>::new(&env));
        env.storage().instance().set(&DataKey::Arbitrator, &arbitrator);
        env.events().publish((Symbol::new(&env, "initialized"),), ());
        Ok(())
    }

    pub fn set_max_funding(env: Env, admin: Address, max_funding: i128) -> Result<(), Error> {
        admin.require_auth();
        let mut config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        if max_funding <= 0 || max_funding < config.funding_target {
            return Err(Error::InvalidAmount);
        }
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended || state.status != CampaignStatus::Open {
            return Err(Error::FundingClosed);
        }
        if env.ledger().timestamp() > config.deadline {
            return Err(Error::DeadlinePassed);
        }
        if state.total_raised > max_funding { return Err(Error::TargetExceeded); }

        config.max_funding = max_funding;
        env.storage().instance().set(&DataKey::Config, &config);
        env.events().publish((Symbol::new(&env, "max_funding"),), max_funding);
        Ok(())
    }

    pub fn invest(env: Env, investor: Address, amount: i128) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.raise_ended { return Err(Error::FundingClosed); }
        if state.status == CampaignStatus::Paused { return Err(Error::Paused); }
        if state.status != CampaignStatus::Open && state.status != CampaignStatus::Funded {
            return Err(Error::FundingClosed);
        }
        if amount <= 0 { return Err(Error::InvalidAmount); }

        let now = env.ledger().timestamp();
        if now > config.deadline { return Err(Error::DeadlinePassed); }

        if state.total_raised >= config.max_funding { return Err(Error::TargetExceeded); }
        let remaining = config.max_funding - state.total_raised;
        if amount > remaining { return Err(Error::TargetExceeded); }

        let next_total = state.total_raised
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let existing = investments.get(investor.clone()).unwrap_or(0);
        let next_investment = existing
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        investments.set(investor.clone(), next_investment);
        env.storage().instance().set(&DataKey::Investments, &investments);

        state.total_raised = next_total;
        if state.status == CampaignStatus::Open
            && state.total_raised >= config.funding_target
        {
            state.status = CampaignStatus::Funded;
            env.events().publish(
                (Symbol::new(&env, "status_changed"), symbol_short!("funded")),
                state.total_raised,
            );
        }
        env.storage().instance().set(&DataKey::State, &state);

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&investor, &env.current_contract_address(), &amount);

        env.events().publish((symbol_short!("invested"), investor), amount);
        Ok(())
    }

    fn refundable_total(total_raised: i128, funding_target: i128) -> Result<i128, Error> {
        if total_raised <= 0 { return Ok(0); }
        if total_raised < funding_target { return Ok(total_raised); }
        total_raised.checked_sub(funding_target).ok_or(Error::InvalidAmount)
    }

    fn refundable_amount(
        total_raised: i128,
        funding_target: i128,
        invested: i128,
    ) -> Result<i128, Error> {
        if total_raised <= 0 || invested <= 0 { return Ok(0); }
        // Must match refundable_total's boundary exactly (strictly `<`, not
        // `<=`): at total_raised == funding_target there is nothing to
        // refund (refundable_total returns 0), so this needs to fall
        // through to the surplus branch below too — which correctly
        // computes 0 there (refundable = total_raised - funding_target =
        // 0) — rather than returning the investor's full stake. The two
        // functions disagreeing at this exact boundary was a real bug:
        // apply_proportional_refund would allocate 100% of an investor's
        // stake as refundable while total_refundable (from
        // refundable_total) said 0 was refundable, leaving a negative
        // residual that early_close/mark_failed rejected with
        // Error::InvalidAmount — i.e. closing a campaign that landed
        // exactly on its funding target could never succeed.
        if total_raised < funding_target { return Ok(invested); }
        let refundable = total_raised
            .checked_sub(funding_target)
            .ok_or(Error::InvalidAmount)?;
        invested
            .checked_mul(refundable)
            .ok_or(Error::InvalidAmount)?
            .checked_div(total_raised)
            .ok_or(Error::InvalidAmount)
    }

    /// Proportionally splits `state.total_raised` between what's retained
    /// (up to `retained_target`) and what becomes refundable (anything
    /// above it), distributing rounding residue one stroop at a time so
    /// every investor's refundable + retained amount always exactly
    /// reconciles with `total_raised` — no dust left unaccounted for.
    ///
    /// Shared by `early_close` (`retained_target` = `funding_target`: keep
    /// the target, refund the surplus above it, or refund everything if
    /// underfunded) and `mark_failed` (`retained_target` =
    /// `state.total_released`: keep nothing beyond what's already left
    /// escrow, refund whatever principal is actually still held). Mutates
    /// `state.total_raised` and `state.raise_ended`, and writes the
    /// `Investments`/`RefundableInvestments` storage maps. Does not write
    /// `State` itself — callers do, alongside their own additional state
    /// changes (`CloseReason`, `status`, ...).
    fn apply_proportional_refund(
        env: &Env,
        state: &mut State,
        retained_target: i128,
    ) -> Result<i128, Error> {
        let total_refundable = Self::refundable_total(state.total_raised, retained_target)?;
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(env));
        let mut refundable: Map<Address, i128> = Map::new(env);
        let mut retained: Map<Address, i128> = Map::new(env);
        let mut allocated = 0i128;

        for (investor, invested) in investments.iter() {
            if invested <= 0 { continue; }
            let amount = Self::refundable_amount(state.total_raised, retained_target, invested)?;
            if amount > 0 {
                refundable.set(investor.clone(), amount);
                allocated = allocated.checked_add(amount).ok_or(Error::InvalidAmount)?;
            }
            let retained_amount = invested
                .checked_sub(amount)
                .ok_or(Error::InvalidAmount)?;
            if retained_amount > 0 {
                retained.set(investor, retained_amount);
            }
        }

        let mut residual = total_refundable
            .checked_sub(allocated)
            .ok_or(Error::InvalidAmount)?;
        if residual > 0 {
            for (investor, invested) in investments.iter() {
                if residual == 0 { break; }
                if invested <= 0 { continue; }
                let current = refundable.get(investor.clone()).unwrap_or(0);
                if current < invested {
                    let next = current.checked_add(1).ok_or(Error::InvalidAmount)?;
                    refundable.set(investor.clone(), next);
                    let retained_amount = invested
                        .checked_sub(next)
                        .ok_or(Error::InvalidAmount)?;
                    if retained_amount > 0 {
                        retained.set(investor, retained_amount);
                    } else {
                        retained.remove(investor);
                    }
                    residual -= 1;
                }
            }
        }
        if residual != 0 { return Err(Error::InvalidAmount); }

        state.total_raised = state.total_raised
            .checked_sub(total_refundable)
            .ok_or(Error::InvalidAmount)?;
        state.raise_ended = true;
        env.storage().instance().set(&DataKey::Investments, &retained);
        env.storage().instance().set(&DataKey::RefundableInvestments, &refundable);
        Ok(total_refundable)
    }

    pub fn early_close(env: Env, admin: Address, close_reason: String) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.raise_ended { return Ok(()); }
        if state.status != CampaignStatus::Open
            && state.status != CampaignStatus::Funded
            && state.status != CampaignStatus::Paused
        {
            return Err(Error::FundingClosed);
        }

        let total_refundable = Self::apply_proportional_refund(&env, &mut state, config.funding_target)?;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::CloseReason, &close_reason);
        env.events().publish(
            (Symbol::new(&env, "early_closed"),),
            (close_reason, total_refundable),
        );
        Ok(())
    }

    pub fn approve(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Funded { return Err(Error::NotFunded); }
        state.status = CampaignStatus::Active;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("active")), ());
        Ok(())
    }

    fn is_partial_release_authorized(caller: &Address, config: &Config) -> bool {
        caller == &config.admin || caller == &config.farmer
    }

    fn checked_partial_release_amount(
        total_raised: i128,
        amount_bps: u32,
        cap_bps: u32,
        released_bps: u32,
    ) -> Result<i128, Error> {
        if amount_bps == 0 || amount_bps > cap_bps {
            return Err(Error::InvalidBps);
        }
        let next_total = released_bps
            .checked_add(amount_bps)
            .ok_or(Error::ReleaseCapExceeded)?;
        if next_total > cap_bps {
            return Err(Error::ReleaseCapExceeded);
        }

        let total_raised_i128 = total_raised;
        let bps_i128 = i128::try_from(amount_bps).map_err(|_| Error::InvalidBps)?;
        let release_total = total_raised_i128
            .checked_mul(bps_i128)
            .ok_or(Error::InvalidAmount)?
            .checked_div(10_000)
            .ok_or(Error::InvalidAmount)?;
        Ok(release_total)
    }

    pub fn partial_release_milestone(
        env: Env,
        caller: Address,
        amount_bps: u32,
    ) -> Result<(), Error> {
        caller.require_auth();

        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if !Self::is_partial_release_authorized(&caller, &config) {
            return Err(Error::Unauthorized);
        }

        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.status != CampaignStatus::Active {
            return Err(Error::NotFunded);
        }

        let release_amount = Self::checked_partial_release_amount(
            state.total_raised,
            amount_bps,
            config.partial_release_cap_bps,
            state.partial_release_total_bps,
        )?;

        if release_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let usdc = token::Client::new(&env, &config.usdc_token);
        state.partial_release_total_bps = state
            .partial_release_total_bps
            .checked_add(amount_bps)
            .ok_or(Error::ReleaseCapExceeded)?;
        state.total_released = state
            .total_released
            .checked_add(release_amount)
            .ok_or(Error::InvalidAmount)?;
        env.storage().instance().set(&DataKey::State, &state);

        usdc.transfer(
            &env.current_contract_address(),
            &config.farmer,
            &release_amount,
        );

        env.events().publish(
            (Symbol::new(&env, "partial_release"),),
            (amount_bps, release_amount),
        );
        Ok(())
    }

    pub fn release_milestone(env: Env, admin: Address, milestone_index: u32) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Active { return Err(Error::NotFunded); }
        if milestone_index >= config.milestone_count { return Err(Error::MilestoneNotFound); }
        if env.storage().instance().has(&DataKey::MilestoneReleased(milestone_index)) {
            return Err(Error::MilestoneAlreadyDone);
        }
        
        // Check for active dispute on this milestone
        if env.storage().instance().has(&DataKey::Dispute(milestone_index)) {
            return Err(Error::DisputeActive);
        }

        let platform_fee = (state.total_raised * config.platform_fee_bps as i128) / 10_000;
        let farmer_pool  = state.total_raised - platform_fee;
        let tranche      = farmer_pool / config.milestone_count as i128;

        // Lock this milestone before invoking the external transfer so a
        // reentrant call sees it already released and errors out.
        env.storage().instance().set(&DataKey::MilestoneReleased(milestone_index), &true);
        state.milestones_released += 1;
        state.total_released = state
            .total_released
            .checked_add(tranche)
            .ok_or(Error::InvalidAmount)?;
        if state.milestones_released >= config.milestone_count {
            state.status = CampaignStatus::Delivered;
            env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("delivered")), ());
        }
        env.storage().instance().set(&DataKey::State, &state);

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &config.farmer, &tranche);

        env.events().publish((symbol_short!("milestone"), milestone_index), tranche);
        Ok(())
    }

    pub fn distribute_revenue(env: Env, admin: Address, revenue_amount: i128) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Delivered { return Err(Error::NotFunded); }
        if env.storage().instance().has(&DataKey::Distributed) { return Err(Error::AlreadyDistributed); }
        if revenue_amount <= 0 { return Err(Error::InvalidAmount); }

        let usdc = token::Client::new(&env, &config.usdc_token);
        let platform_fee  = (revenue_amount * config.platform_fee_bps as i128) / 10_000;
        let investor_pool = revenue_amount - platform_fee;

        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let total_raised = state.total_raised;

        // Lock distribution state before invoking external transfers so a
        // reentrant call sees `Distributed == true` and is rejected immediately.
        env.storage().instance().set(&DataKey::Distributed, &true);
        state.status = CampaignStatus::Completed;
        env.storage().instance().set(&DataKey::State, &state);

        // Iterate directly over the Map for better gas efficiency
        for (investor, invested) in investments.iter() {
            if invested > 0 && total_raised > 0 {
                let share = (investor_pool * invested) / total_raised;
                if share > 0 {
                    usdc.transfer(&env.current_contract_address(), &investor, &share);
                    env.events().publish((symbol_short!("payout"), investor), share);
                }
            }
        }
        if platform_fee > 0 {
            usdc.transfer(&env.current_contract_address(), &config.admin, &platform_fee);
        }

        env.events().publish((symbol_short!("complete"),), revenue_amount);
        Ok(())
    }

    fn claim_refund(
        env: &Env,
        state: &mut State,
        investor: &Address,
    ) -> Result<Option<i128>, Error> {
        let mut refunded: Map<Address, bool> = env.storage().instance()
            .get(&DataKey::Refunded).unwrap_or_else(|| Map::new(env));
        if refunded.get(investor.clone()).unwrap_or(false) {
            return Ok(None);
        }

        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(env));
        let mut refundable: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::RefundableInvestments).unwrap_or_else(|| Map::new(env));
        let amount = if state.raise_ended {
            refundable.get(investor.clone()).unwrap_or(0)
        } else {
            investments.get(investor.clone()).unwrap_or(0)
        };
        if amount <= 0 { return Err(Error::InsufficientFunds); }

        if state.raise_ended {
            refundable.set(investor.clone(), 0);
        } else {
            state.total_raised = state.total_raised
                .checked_sub(amount)
                .ok_or(Error::InvalidAmount)?;
            investments.set(investor.clone(), 0);
        }
        refunded.set(investor.clone(), true);
        env.storage().instance().set(&DataKey::Refunded, &refunded);
        if !state.raise_ended {
            env.storage().instance().set(&DataKey::Investments, &investments);
        }
        env.storage().instance().set(&DataKey::RefundableInvestments, &refundable);
        Ok(Some(amount))
    }

    pub fn refund(env: Env, investor: Address) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let can_refund = state.raise_ended
            || state.status == CampaignStatus::Failed
            || ((state.status == CampaignStatus::Open
                || state.status == CampaignStatus::Paused)
                && now > config.deadline);
        if !can_refund { return Err(Error::RefundNotAllowed); }

        let amount = match Self::claim_refund(&env, &mut state, &investor)? {
            Some(amount) => amount,
            None => return Ok(()),
        };
        env.storage().instance().set(&DataKey::State, &state);
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &investor, &amount);
        env.events().publish((symbol_short!("refund"), investor), amount);
        Ok(())
    }

    pub fn refund_by_admin(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let can_refund = state.raise_ended
            || state.status == CampaignStatus::Failed
            || ((state.status == CampaignStatus::Open
                || state.status == CampaignStatus::Paused)
                && now > config.deadline);
        if !can_refund { return Err(Error::RefundNotAllowed); }

        let amount = match Self::claim_refund(&env, &mut state, &investor)? {
            Some(amount) => amount,
            None => return Ok(()),
        };
        env.storage().instance().set(&DataKey::State, &state);
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &investor, &amount);
        env.events().publish((symbol_short!("refund"), investor), amount);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended {
            return Err(Error::FundingClosed);
        }
        state.status = CampaignStatus::Paused;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("paused")), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended {
            return Err(Error::FundingClosed);
        }
        state.status = CampaignStatus::Open;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("open")), ());
        Ok(())
    }

    /// Marks the campaign Failed and makes whatever principal is still
    /// actually held in escrow refundable to investors.
    ///
    /// Bug this fixes: `release_milestone`/`partial_release_milestone` pay
    /// real USDC out of escrow to the farmer but never reduce
    /// `total_raised` (it's a "how much was ever raised" ledger figure,
    /// not a live balance). Before this fix, marking a campaign Failed
    /// after any funds had already been released left `raise_ended`
    /// false, so `refund()`/`refund_by_admin()` fell through to the
    /// full-original-investment path — promising every investor their
    /// entire stake back even though part of the contract's balance was
    /// already gone. Whoever claimed first would succeed; later claimants'
    /// transfers could fail for insufficient contract balance, or in the
    /// worst case (a campaign marked Failed after full delivery and
    /// revenue distribution) investors would be paid their principal
    /// *again*, on top of the revenue share they already received via
    /// `distribute_revenue`.
    ///
    /// The fix: route through the same proportional-refund math
    /// `early_close` uses (`apply_proportional_refund`), treating
    /// `state.total_released` (the cumulative amount actually paid to the
    /// farmer so far — tracked directly at each release site) as the
    /// "retained" target instead of `funding_target`. Each investor's
    /// refundable share becomes proportional to what's actually left,
    /// never more than the contract can pay out. If nothing was ever
    /// released, this is equivalent to a full refund of everyone's
    /// original investment — the previously-intended behavior for the
    /// common case, just made explicit and safe for the uncommon one.
    pub fn mark_failed(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        // Idempotent, matching early_close: a repeat call after the raise
        // already ended (whether via mark_failed or early_close) is a
        // no-op rather than an error.
        if state.raise_ended {
            return Ok(());
        }
        state.status = CampaignStatus::Failed;
        let retained_target = state.total_released;
        let total_refundable = Self::apply_proportional_refund(&env, &mut state, retained_target)?;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("failed")), ());
        env.events().publish((Symbol::new(&env, "failed_refund"),), total_refundable);
        Ok(())
    }

    // ── Dispute resolution lifecycle (#1004) ─────────────────────────────────

    fn configured_voting_window(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::VotingWindow)
            .unwrap_or(DEFAULT_VOTING_WINDOW_SECS)
    }

    /// Voting window, in seconds, granted to newly opened disputes.
    pub fn get_dispute_voting_window(env: Env) -> u64 {
        Self::configured_voting_window(&env)
    }

    /// Admin-setable voting window. Applies to disputes opened after the call:
    /// an open dispute keeps the deadline it was opened with, so a late
    /// governance change can never move a live voting deadline.
    pub fn set_dispute_voting_window(
        env: Env,
        admin: Address,
        seconds: u64,
    ) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        if seconds == 0 { return Err(Error::InvalidAmount); }
        env.storage().instance().set(&DataKey::VotingWindow, &seconds);
        Ok(())
    }

    fn address_in(pool: &Vec<Address>, addr: &Address) -> bool {
        for i in 0..pool.len() {
            if let Some(candidate) = pool.get(i) {
                if candidate == *addr {
                    return true;
                }
            }
        }
        false
    }

    /// Arbitrators allowed to vote. Falls back to the single address stored by
    /// `initialize`/`update_arbitrator`, so campaigns deployed before
    /// multi-arbitrator voting keep working with a one-vote quorum.
    fn arbitrator_pool(env: &Env) -> Vec<Address> {
        if let Some(pool) = env.storage()
            .instance()
            .get::<DataKey, Vec<Address>>(&DataKey::ArbitratorPool)
        {
            if !pool.is_empty() {
                return pool;
            }
        }
        let mut fallback = Vec::new(env);
        if let Some(arbitrator) = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Arbitrator)
        {
            fallback.push_back(arbitrator);
        }
        fallback
    }

    pub fn get_arbitrator_pool(env: Env) -> Vec<Address> {
        Self::arbitrator_pool(&env)
    }

    /// Replace the arbitrator roster. Gated the same way as
    /// `update_arbitrator`: only the admin, and only before the raise ends.
    pub fn set_arbitrator_pool(
        env: Env,
        admin: Address,
        pool: Vec<Address>,
    ) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended || state.status != CampaignStatus::Open {
            return Err(Error::Unauthorized);
        }
        if pool.is_empty() { return Err(Error::EmptyArbitratorPool); }
        env.storage().instance().set(&DataKey::ArbitratorPool, &pool);
        env.events()
            .publish((Symbol::new(&env, "arbitrator_pool_set"),), pool.len());
        Ok(())
    }

    /// Strict majority of the roster.
    fn vote_quorum(env: &Env) -> u32 {
        let size = Self::arbitrator_pool(env).len();
        if size == 0 {
            1
        } else {
            size / 2 + 1
        }
    }

    fn is_dispute_party(env: &Env, caller: &Address, config: &Config) -> bool {
        if caller == &config.admin || caller == &config.farmer {
            return true;
        }
        // Investors fund the escrow, so they can raise and evidence disputes.
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments)
            .unwrap_or_else(|| Map::new(env));
        investments.get(caller.clone()).unwrap_or(0) > 0
    }

    fn load_dispute(env: &Env, milestone_index: u32) -> Result<Dispute, Error> {
        env.storage()
            .instance()
            .get(&DataKey::DisputeRecord(milestone_index))
            .ok_or(Error::NoDispute)
    }

    /// Raise a dispute on a specific milestone.
    ///
    /// Open by the admin, the farmer, or any investor with a stake in the
    /// campaign. Opening freezes the milestone tranche (the legacy
    /// `DataKey::Dispute` flag `release_milestone` still reads) and starts the
    /// arbitrator voting window.
    pub fn raise_dispute(env: Env, caller: Address, milestone_index: u32) -> Result<(), Error> {
        caller.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if !Self::is_dispute_party(&env, &caller, &config) {
            return Err(Error::Unauthorized);
        }

        if state.status != CampaignStatus::Active { return Err(Error::NotFunded); }
        if milestone_index >= config.milestone_count { return Err(Error::MilestoneNotFound); }
        if env.storage().instance().has(&DataKey::MilestoneReleased(milestone_index)) {
            return Err(Error::MilestoneAlreadyDone);
        }
        if env.storage().instance().has(&DataKey::Dispute(milestone_index)) {
            return Err(Error::DisputeActive);
        }

        let now = env.ledger().timestamp();
        let voting_deadline = now
            .checked_add(Self::configured_voting_window(&env))
            .ok_or(Error::InvalidAmount)?;

        let dispute = Dispute {
            milestone_index,
            raised_by: caller.clone(),
            opened_at: now,
            voting_deadline,
            phase: DisputePhase::Open,
            release_votes: 0,
            refund_votes: 0,
            voters: Vec::new(&env),
            evidence: Vec::new(&env),
            verdict: None,
        };

        // Write the legacy freeze flag first so pre-#1004 readers
        // (`has_dispute`, `release_milestone`) see the milestone blocked.
        env.storage().instance().set(&DataKey::Dispute(milestone_index), &true);
        env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);
        env.events()
            .publish((Symbol::new(&env, "dispute_raised"), milestone_index), (caller, voting_deadline));
        Ok(())
    }

    /// Attach an evidence reference (document URI) to a dispute that has not
    /// been decided yet. Parties only: admin, farmer, or a staked investor.
    pub fn submit_dispute_evidence(
        env: Env,
        caller: Address,
        milestone_index: u32,
        uri: String,
    ) -> Result<(), Error> {
        caller.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if !Self::is_dispute_party(&env, &caller, &config) {
            return Err(Error::Unauthorized);
        }
        if uri.is_empty() { return Err(Error::InvalidEvidence); }

        let mut dispute = Self::load_dispute(&env, milestone_index)?;
        if dispute.phase == DisputePhase::Verdict || dispute.phase == DisputePhase::Resolved {
            return Err(Error::DisputeDecided);
        }
        if dispute.evidence.len() >= MAX_DISPUTE_EVIDENCE {
            return Err(Error::EvidenceLimitReached);
        }

        let now = env.ledger().timestamp();
        dispute.evidence.push_back(Evidence {
            submitter: caller.clone(),
            uri: uri.clone(),
            submitted_at: now,
        });
        env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);
        env.events()
            .publish((Symbol::new(&env, "dispute_evidence"), milestone_index), (caller, uri));
        Ok(())
    }

    /// Cast an arbitrator vote on an open dispute. Votes only count inside the
    /// voting window, each arbitrator votes once, and a majority immediately
    /// records the verdict so it can no longer be changed.
    pub fn cast_dispute_vote(
        env: Env,
        voter: Address,
        milestone_index: u32,
        release: bool,
    ) -> Result<(), Error> {
        voter.require_auth();
        let pool = Self::arbitrator_pool(&env);
        if !Self::address_in(&pool, &voter) { return Err(Error::NotAnArbitrator); }

        let mut dispute = Self::load_dispute(&env, milestone_index)?;
        if dispute.verdict.is_some() { return Err(Error::DisputeDecided); }

        let now = env.ledger().timestamp();
        if now > dispute.voting_deadline { return Err(Error::VotingWindowClosed); }
        if Self::address_in(&dispute.voters, &voter) { return Err(Error::AlreadyVoted); }

        dispute.voters.push_back(voter.clone());
        if release {
            dispute.release_votes += 1;
        } else {
            dispute.refund_votes += 1;
        }
        dispute.phase = DisputePhase::Arbitration;

        let quorum = Self::vote_quorum(&env);
        if dispute.release_votes >= quorum {
            dispute.phase = DisputePhase::Verdict;
            dispute.verdict = Some(true);
        } else if dispute.refund_votes >= quorum {
            dispute.phase = DisputePhase::Verdict;
            dispute.verdict = Some(false);
        }
        env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);

        env.events()
            .publish((Symbol::new(&env, "dispute_vote"), milestone_index), (voter, release));
        if let Some(decision) = dispute.verdict {
            env.events()
                .publish((Symbol::new(&env, "dispute_verdict"), milestone_index), decision);
        }
        Ok(())
    }

    /// Record the verdict once the voting window has elapsed.
    ///
    /// Majority of the votes cast wins; a tie or a window that closed with no
    /// votes at all resolves to `Refund`, so escrowed principal is never paid
    /// out without an affirmative decision. Replaying this call returns the
    /// verdict that was already recorded.
    pub fn finalize_dispute(
        env: Env,
        caller: Address,
        milestone_index: u32,
    ) -> Result<DisputeOutcome, Error> {
        caller.require_auth();
        let mut dispute = Self::load_dispute(&env, milestone_index)?;
        if let Some(decision) = dispute.verdict {
            return Ok(Self::outcome_of(decision));
        }

        let now = env.ledger().timestamp();
        if now <= dispute.voting_deadline { return Err(Error::VotingNotOver); }

        let release = dispute.release_votes > dispute.refund_votes;
        dispute.phase = DisputePhase::Verdict;
        dispute.verdict = Some(release);
        env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);
        env.events()
            .publish((Symbol::new(&env, "dispute_verdict"), milestone_index), release);
        Ok(Self::outcome_of(release))
    }

    fn outcome_of(release: bool) -> DisputeOutcome {
        if release {
            DisputeOutcome::Release
        } else {
            DisputeOutcome::Refund
        }
    }

    /// Execute a dispute's recorded verdict and unblock the milestone.
    ///
    /// `Release` pays the milestone tranche to the farmer; `Refund` turns
    /// whatever principal is still held in escrow into investor refunds, using
    /// the same proportional math as `mark_failed`. Callable by an arbitrator
    /// or the admin once the verdict exists.
    ///
    /// Idempotent by design: the freeze flag and the `Resolved` phase are
    /// written before any external transfer, so a replayed call (an indexer
    /// retry, a second click) returns the outcome without moving money twice.
    pub fn resolve_dispute(
        env: Env,
        caller: Address,
        milestone_index: u32,
    ) -> Result<DisputeOutcome, Error> {
        caller.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let pool = Self::arbitrator_pool(&env);
        if !Self::address_in(&pool, &caller) && caller != config.admin {
            return Err(Error::Unauthorized);
        }

        let mut dispute = Self::load_dispute(&env, milestone_index)?;
        let release = match dispute.verdict {
            Some(release) => release,
            None => {
                // Verdict not recorded yet: allow the window to close and
                // derive it here rather than requiring a separate finalize tx.
                let now = env.ledger().timestamp();
                if now <= dispute.voting_deadline { return Err(Error::VotingNotOver); }
                let derived = dispute.release_votes > dispute.refund_votes;
                dispute.phase = DisputePhase::Verdict;
                dispute.verdict = Some(derived);
                env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);
                env.events()
                    .publish((Symbol::new(&env, "dispute_verdict"), milestone_index), derived);
                derived
            }
        };
        let outcome = Self::outcome_of(release);
        if dispute.phase == DisputePhase::Resolved {
            return Ok(outcome);
        }

        // Clear the freeze flag and record `Resolved` before touching any
        // external token so a reentrant call short-circuits above.
        env.storage().instance().remove(&DataKey::Dispute(milestone_index));
        dispute.phase = DisputePhase::Resolved;
        env.storage().instance().set(&DataKey::DisputeRecord(milestone_index), &dispute);

        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        let usdc = token::Client::new(&env, &config.usdc_token);

        match outcome {
            DisputeOutcome::Release => {
                let platform_fee = (state.total_raised * config.platform_fee_bps as i128) / 10_000;
                let farmer_pool  = state.total_raised - platform_fee;
                let tranche      = farmer_pool / config.milestone_count as i128;

                env.storage().instance().set(&DataKey::MilestoneReleased(milestone_index), &true);
                state.milestones_released += 1;
                // Track the payout so later refund math can never hand back
                // principal that already left escrow (`mark_failed` reads this).
                state.total_released = state
                    .total_released
                    .checked_add(tranche)
                    .ok_or(Error::InvalidAmount)?;
                if state.milestones_released >= config.milestone_count {
                    state.status = CampaignStatus::Delivered;
                    env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("delivered")), ());
                }
                env.storage().instance().set(&DataKey::State, &state);

                usdc.transfer(&env.current_contract_address(), &config.farmer, &tranche);
                env.events().publish((symbol_short!("milestone"), milestone_index), tranche);
            }
            DisputeOutcome::Refund => {
                state.status = CampaignStatus::Failed;
                let retained = state.total_released;
                let total_refundable =
                    Self::apply_proportional_refund(&env, &mut state, retained)?;
                env.storage().instance().set(&DataKey::State, &state);
                env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("failed")), ());
                env.events().publish((Symbol::new(&env, "failed_refund"),), total_refundable);
            }
        }

        env.events()
            .publish((Symbol::new(&env, "dispute_resolved"), milestone_index), release);
        Ok(outcome)
    }

    /// Update the arbitrator address
    /// Can only be called by admin before campaign is funded
    pub fn update_arbitrator(env: Env, admin: Address, new_arbitrator: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        
        // Prevent modification after funding has started
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended || state.status != CampaignStatus::Open {
            return Err(Error::Unauthorized);
        }
        
        env.storage().instance().set(&DataKey::Arbitrator, &new_arbitrator);
        env.events().publish((Symbol::new(&env, "arbitrator_updated"),), new_arbitrator);
        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
    }

    pub fn get_state(env: Env) -> Result<State, Error> {
        env.storage().instance().get(&DataKey::State).ok_or(Error::NotInitialized)
    }

    pub fn is_raise_ended(env: Env) -> bool {
        let state: State = match env.storage().instance().get(&DataKey::State) {
            Some(state) => state,
            None => return false,
        };
        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(config) => config,
            None => return state.raise_ended,
        };
        state.raise_ended || env.ledger().timestamp() > config.deadline
    }

    pub fn get_close_reason(env: Env) -> Option<String> {
        env.storage().instance().get(&DataKey::CloseReason)
    }

    pub fn get_refundable_amount(env: Env, investor: Address) -> i128 {
        let refundable: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::RefundableInvestments).unwrap_or_else(|| Map::new(&env));
        refundable.get(investor).unwrap_or(0)
    }

    pub fn get_investment(env: Env, investor: Address) -> i128 {
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        investments.get(investor).unwrap_or(0)
    }

    pub fn get_ownership_pct(env: Env, investor: Address) -> i128 {
        let state: State = match env.storage().instance().get(&DataKey::State) {
            Some(s) => s,
            None => return 0,
        };
        if state.total_raised == 0 { return 0; }
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let invested = investments.get(investor).unwrap_or(0);
        (invested * 10_000) / state.total_raised
    }

    pub fn has_dispute(env: Env, milestone_index: u32) -> bool {
        env.storage().instance().has(&DataKey::Dispute(milestone_index))
    }

    /// Full dispute record for a milestone, including phase, voting deadline,
    /// tally, evidence and recorded outcome. `None` once no dispute was ever
    /// opened on that milestone.
    pub fn get_dispute(env: Env, milestone_index: u32) -> Option<Dispute> {
        env.storage().instance().get(&DataKey::DisputeRecord(milestone_index))
    }

    pub fn get_dispute_phase(env: Env, milestone_index: u32) -> Option<DisputePhase> {
        Self::load_dispute(&env, milestone_index).ok().map(|d| d.phase)
    }

    pub fn get_dispute_voting_deadline(env: Env, milestone_index: u32) -> Option<u64> {
        Self::load_dispute(&env, milestone_index).ok().map(|d| d.voting_deadline)
    }

    pub fn get_arbitrator(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::Arbitrator).ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_release_amount_respects_cumulative_cap() {
        let total_raised = 100_000_i128;
        let first = FarmCampaignContract::checked_partial_release_amount(
            total_raised,
            2_500,
            9_800,
            0,
        )
        .unwrap();
        assert_eq!(first, 2_500);

        let second = FarmCampaignContract::checked_partial_release_amount(
            total_raised,
            5_000,
            9_800,
            2_500,
        )
        .unwrap();
        assert_eq!(second, 5_000);

        let cumulative = 2_500u32 + 5_000u32;
        assert!(cumulative <= 9_800);
    }

    #[test]
    fn partial_release_amount_reverts_if_cumulative_total_exceeds_cap() {
        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            7_000,
            9_800,
            3_500,
        )
        .unwrap_err();
        assert_eq!(err, Error::ReleaseCapExceeded);
    }

    #[test]
    fn partial_release_amount_reverts_if_bps_are_invalid() {
        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            0,
            9_800,
            0,
        )
        .unwrap_err();
        assert_eq!(err, Error::InvalidBps);

        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            10_001,
            9_800,
            0,
        )
        .unwrap_err();
        assert_eq!(err, Error::InvalidBps);
    }

    #[test]
    fn partial_release_authorization_requires_admin_or_farmer() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let investor = Address::generate(&env);

        let config = Config {
            admin: admin.clone(),
            farmer: farmer.clone(),
            arbitrator: Address::generate(&env),
            usdc_token: Address::generate(&env),
            funding_target: 100_000,
            deadline: 0,
            platform_fee_bps: 200,
            milestone_count: 3,
            partial_release_cap_bps: 9_800,
            project_name: String::from_str(&env, "demo"),
            commodity: String::from_str(&env, "maize"),
            max_funding: 100_000,
        };

        assert!(FarmCampaignContract::is_partial_release_authorized(&admin, &config));
        assert!(FarmCampaignContract::is_partial_release_authorized(&farmer, &config));
        assert!(!FarmCampaignContract::is_partial_release_authorized(&investor, &config));
    }

    use soroban_sdk::testutils::{Address as _, Ledger};

    struct CampaignSetup {
        env: Env,
        contract_id: Address,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_address: Address,
        investor_a: Address,
        investor_b: Address,
    }

    fn setup_campaign(funding_target: i128, max_funding: i128) -> CampaignSetup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(100);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = env.register_stellar_asset_contract(admin.clone());
        let investor_a = Address::generate(&env);
        let investor_b = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);

        FarmCampaignContractClient::new(&env, &contract_id).initialize_with_max_funding(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &funding_target,
            &max_funding,
            &1000,
            &CampaignTerms { platform_fee_bps: 200, milestone_count: 3, partial_release_cap_bps: 9800 },
            &CampaignMetadata {
                project_name: String::from_str(&env, "demo"),
                commodity: String::from_str(&env, "maize"),
            },
        );

        CampaignSetup {
            env,
            contract_id,
            admin,
            farmer,
            arbitrator,
            usdc_address,
            investor_a,
            investor_b,
        }
    }

    impl CampaignSetup {
        fn usdc(&self) -> token::Client<'_> {
            token::Client::new(&self.env, &self.usdc_address)
        }

        /// Minting lives on the Stellar Asset Contract's admin interface,
        /// a separate generated client from the regular `token::Client`
        /// used for balance/transfer.
        fn usdc_admin(&self) -> token::StellarAssetClient<'_> {
            token::StellarAssetClient::new(&self.env, &self.usdc_address)
        }

        fn client(&self) -> FarmCampaignContractClient<'_> {
            FarmCampaignContractClient::new(&self.env, &self.contract_id)
        }
    }

    fn invest(setup: &CampaignSetup, investor: &Address, amount: i128) {
        setup.usdc_admin().mint(investor, &amount);
        setup.client().invest(investor, &amount);
    }

    #[test]
    fn max_funding_rejects_over_cap_without_trimming() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        invest(&setup, &setup.investor_b, 30);

        setup.usdc_admin().mint(&setup.investor_a, &1);
        let balance_before = setup.usdc().balance(&setup.investor_a);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::TargetExceeded)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_before);
        assert_eq!(setup.client().get_state().total_raised, 150);
    }

    #[test]
    fn early_close_refunds_underfunded_contributions_in_full() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 30);
        invest(&setup, &setup.investor_b, 40);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "campaign cancelled"),
        );

        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            30,
        );
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_b),
            40,
        );

        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 30);
        setup.client().refund_by_admin(&setup.admin, &setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 40);
    }

    #[test]
    fn early_close_refunds_only_the_surplus_pro_rata() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 60);
        invest(&setup, &setup.investor_b, 60);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            10,
        );
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_b),
            10,
        );
        assert_eq!(setup.client().get_state().total_raised, 100);
        assert_eq!(setup.client().get_investment(&setup.investor_a), 50);
        assert_eq!(setup.client().get_investment(&setup.investor_b), 50);

        setup.client().refund(&setup.investor_a);
        setup.client().refund(&setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 10);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 10);
    }

    #[test]
    fn duplicate_early_close_is_an_idempotent_no_op() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        let reason = String::from_str(&setup.env, "first reason");

        setup.client().early_close(&setup.admin, &reason);
        let refundable_before = setup.client().get_refundable_amount(&setup.investor_a);
        let result = setup.client().try_early_close(
            &setup.admin,
            &String::from_str(&setup.env, "second reason"),
        );

        assert_eq!(result, Ok(Ok(())));
        assert!(setup.client().is_raise_ended());
        assert_eq!(setup.client().get_close_reason(), Some(reason));
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            refundable_before,
        );
    }

    #[test]
    fn early_close_preserves_retained_investments_after_residual_allocation() {
        let setup = setup_campaign(1, 2);
        invest(&setup, &setup.investor_a, 1);
        invest(&setup, &setup.investor_b, 1);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        let retained = setup.client().get_investment(&setup.investor_a)
            + setup.client().get_investment(&setup.investor_b);
        assert_eq!(setup.client().get_state().total_raised, 1);
        assert_eq!(retained, 1);
    }

    #[test]
    fn refunds_are_not_repeated_after_early_close() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        setup.client().refund(&setup.investor_a);
        let balance_after_first = setup.usdc().balance(&setup.investor_a);
        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_after_first);
    }

    #[test]
    fn invest_is_rejected_after_early_close() {
        let setup = setup_campaign(100, 150);
        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        setup.usdc_admin().mint(&setup.investor_a, &1);
        let balance_before = setup.usdc().balance(&setup.investor_a);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::FundingClosed)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_before);
    }

    #[test]
    fn invest_is_rejected_after_the_raise_deadline() {
        let setup = setup_campaign(100, 150);
        setup.env.ledger().set_timestamp(1001);
        setup.usdc_admin().mint(&setup.investor_a, &1);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::DeadlinePassed)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), 1);
    }

    #[test]
    fn underfunded_raise_allows_full_refund_after_the_deadline() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 30);
        setup.env.ledger().set_timestamp(1001);

        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 30);
        assert_eq!(setup.client().get_state().total_raised, 0);
    }

    #[test]
    fn max_funding_cannot_be_below_the_target() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);
        let client = FarmCampaignContractClient::new(&env, &contract_id);

        let result = client.try_initialize_with_max_funding(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &100,
            &99,
            &1000,
            &CampaignTerms { platform_fee_bps: 200, milestone_count: 3, partial_release_cap_bps: 9800 },
            &CampaignMetadata {
                project_name: String::from_str(&env, "demo"),
                commodity: String::from_str(&env, "maize"),
            },
        );

        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn legacy_initialize_defaults_the_cap_to_the_target() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);

        let client = FarmCampaignContractClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &100,
            &1000,
            &CampaignTerms { platform_fee_bps: 200, milestone_count: 3, partial_release_cap_bps: 9800 },
            &CampaignMetadata {
                project_name: String::from_str(&env, "demo"),
                commodity: String::from_str(&env, "maize"),
            },
        );

        assert_eq!(client.get_config().max_funding, 100);
    }

    #[test]
    fn mark_failed_after_milestone_release_only_refunds_remaining_escrow() {
        // Regression test for the fix in this PR: release_milestone pays
        // real USDC out of escrow but never reduces total_raised, so
        // marking a campaign Failed after a release must not promise
        // investors their full original stake back — only what's actually
        // still held.
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 60);
        invest(&setup, &setup.investor_b, 40);
        setup.client().approve(&setup.admin);
        setup.client().release_milestone(&setup.admin, &0);

        let released = setup.client().get_state().total_released;
        assert!(released > 0, "sanity check: release_milestone should have released something");

        setup.client().mark_failed(&setup.admin);

        let remaining = 100 - released;
        let refundable_a = setup.client().get_refundable_amount(&setup.investor_a);
        let refundable_b = setup.client().get_refundable_amount(&setup.investor_b);
        assert_eq!(refundable_a + refundable_b, remaining);
        assert!(
            refundable_a < 60,
            "investor_a must not be refunded their full original stake once funds were already released"
        );
        assert!(
            refundable_b < 40,
            "investor_b must not be refunded their full original stake once funds were already released"
        );
        // total_raised after the operation reflects what's retained (i.e.
        // already released to the farmer), not what was refunded —
        // consistent with early_close's existing behavior.
        assert_eq!(setup.client().get_state().total_raised, released);

        setup.client().refund(&setup.investor_a);
        setup.client().refund(&setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_a), refundable_a);
        assert_eq!(setup.usdc().balance(&setup.investor_b), refundable_b);
    }

    #[test]
    fn mark_failed_with_nothing_released_refunds_full_investment() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 60);
        invest(&setup, &setup.investor_b, 40);

        setup.client().mark_failed(&setup.admin);

        assert_eq!(setup.client().get_refundable_amount(&setup.investor_a), 60);
        assert_eq!(setup.client().get_refundable_amount(&setup.investor_b), 40);
        assert_eq!(setup.client().get_state().total_raised, 0);

        setup.client().refund(&setup.investor_a);
        setup.client().refund(&setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 60);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 40);
    }

    #[test]
    fn duplicate_mark_failed_is_an_idempotent_no_op() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 100);

        setup.client().mark_failed(&setup.admin);
        let refundable_before = setup.client().get_refundable_amount(&setup.investor_a);

        let result = setup.client().try_mark_failed(&setup.admin);
        assert_eq!(result, Ok(Ok(())));
        assert!(setup.client().is_raise_ended());
        assert_eq!(setup.client().get_refundable_amount(&setup.investor_a), refundable_before);
    }

    #[test]
    fn mark_failed_after_early_close_is_a_no_op() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 100);
        setup.client().early_close(&setup.admin, &String::from_str(&setup.env, "closed early"));

        let refundable_before = setup.client().get_refundable_amount(&setup.investor_a);
        let result = setup.client().try_mark_failed(&setup.admin);
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(setup.client().get_refundable_amount(&setup.investor_a), refundable_before);
    }

    // ── Dispute resolution lifecycle (#1004) ──────────────────────────────────

    /// Fund the campaign to its target and move it to Active — the only status
    /// a milestone dispute can be raised against.
    fn advance_to_active(setup: &CampaignSetup) {
        invest(setup, &setup.investor_a, 60);
        invest(setup, &setup.investor_b, 40);
        setup.client().approve(&setup.admin);
    }

    fn active_campaign() -> CampaignSetup {
        let setup = setup_campaign(100, 150);
        advance_to_active(&setup);
        setup
    }

    fn dispute_window() -> u64 {
        DEFAULT_VOTING_WINDOW_SECS
    }

    #[test]
    fn raising_a_dispute_opens_the_voting_window_and_freezes_the_milestone() {
        let setup = active_campaign();

        setup.client().raise_dispute(&setup.admin, &0);
        assert!(setup.client().has_dispute(&0));

        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.phase, DisputePhase::Open);
        assert_eq!(dispute.raised_by, setup.admin);
        assert_eq!(dispute.opened_at, 100);
        assert_eq!(dispute.voting_deadline, 100 + dispute_window());
        assert_eq!(dispute.release_votes, 0);
        assert_eq!(dispute.refund_votes, 0);
        assert!(dispute.outcome().is_none());

        // The frozen tranche cannot be released while the dispute is live.
        assert_eq!(
            setup.client().try_release_milestone(&setup.admin, &0),
            Err(Ok(Error::DisputeActive))
        );
    }

    #[test]
    fn investors_can_raise_and_evidence_a_dispute() {
        let setup = active_campaign();

        setup
            .client()
            .raise_dispute(&setup.investor_a, &1);
        assert!(setup.client().has_dispute(&1));

        let uri = String::from_str(&setup.env, "ipfs://evidence-delivery-1");
        setup
            .client()
            .submit_dispute_evidence(&setup.investor_a, &1, &uri);

        let dispute = setup.client().get_dispute(&1).expect("dispute recorded");
        assert_eq!(dispute.evidence.len(), 1);
        let entry = dispute.evidence.get(0).expect("evidence entry");
        assert_eq!(entry.submitter, setup.investor_a);
        assert_eq!(entry.uri, uri);
        assert_eq!(entry.submitted_at, 100);
    }

    #[test]
    fn unrelated_addresses_cannot_raise_or_evidence_a_dispute() {
        let setup = active_campaign();
        let stranger = Address::generate(&setup.env);

        assert_eq!(
            setup.client().try_raise_dispute(&stranger, &0),
            Err(Ok(Error::Unauthorized))
        );

        setup.client().raise_dispute(&setup.farmer, &0);
        let uri = String::from_str(&setup.env, "ipfs://not-yours");
        assert_eq!(
            setup.client().try_submit_dispute_evidence(&stranger, &0, &uri),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn votes_are_only_accepted_inside_the_voting_window() {
        let setup = setup_campaign(100, 150);
        let arb_b = Address::generate(&setup.env);
        let pool = Vec::from_array(&setup.env, [setup.arbitrator.clone(), arb_b.clone()]);
        setup.client().set_arbitrator_pool(&setup.admin, &pool);

        advance_to_active(&setup);
        setup.client().raise_dispute(&setup.admin, &0);

        // One second before the deadline still counts.
        setup.env.ledger().set_timestamp(100 + dispute_window() - 1);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &false);
        assert_eq!(setup.client().get_dispute(&0).expect("dispute recorded").refund_votes, 1);

        // Past the deadline the window is closed, so the second arbitrator's
        // vote — which would otherwise have decided the dispute — is rejected.
        setup.env.ledger().set_timestamp(100 + dispute_window() + 1);
        assert_eq!(
            setup.client().try_cast_dispute_vote(&arb_b, &0, &true),
            Err(Ok(Error::VotingWindowClosed))
        );
        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.release_votes, 0);
        assert!(dispute.outcome().is_none());
    }

    #[test]
    fn only_arbitrator_pool_members_can_vote() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        let stranger = Address::generate(&setup.env);

        assert_eq!(
            setup.client().try_cast_dispute_vote(&stranger, &0, &true),
            Err(Ok(Error::NotAnArbitrator))
        );
    }

    #[test]
    fn an_arbitrator_votes_once_and_the_verdict_is_single() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);
        assert_eq!(
            setup.client().try_cast_dispute_vote(&setup.arbitrator, &0, &false),
            Err(Ok(Error::DisputeDecided))
        );

        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.refund_votes, 0);
        assert_eq!(dispute.outcome(), Some(DisputeOutcome::Release));
    }

    #[test]
    fn majority_of_a_multi_arbitrator_pool_is_required_for_a_verdict() {
        let setup = setup_campaign(100, 150);
        let arb_b = Address::generate(&setup.env);
        let arb_c = Address::generate(&setup.env);
        let pool = Vec::from_array(&setup.env, [setup.arbitrator.clone(), arb_b.clone(), arb_c.clone()]);
        setup.client().set_arbitrator_pool(&setup.admin, &pool);
        assert_eq!(setup.client().get_arbitrator_pool().len(), 3);

        advance_to_active(&setup);
        setup.client().raise_dispute(&setup.admin, &0);

        // One of three votes is below the majority quorum of two: no verdict.
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);
        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.phase, DisputePhase::Arbitration);
        assert!(dispute.outcome().is_none());

        // Second matching vote reaches quorum and locks the verdict.
        setup.client().cast_dispute_vote(&arb_b, &0, &true);
        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.phase, DisputePhase::Verdict);
        assert_eq!(dispute.outcome(), Some(DisputeOutcome::Release));
    }

    #[test]
    fn arbitrator_pool_cannot_be_changed_once_the_raise_has_started() {
        let setup = setup_campaign(100, 150);
        advance_to_active(&setup);
        let pool = Vec::from_array(&setup.env, [setup.arbitrator.clone()]);

        assert_eq!(
            setup.client().try_set_arbitrator_pool(&setup.admin, &pool),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn empty_arbitrator_pool_is_rejected() {
        let setup = setup_campaign(100, 150);
        let pool: Vec<Address> = Vec::new(&setup.env);

        assert_eq!(
            setup.client().try_set_arbitrator_pool(&setup.admin, &pool),
            Err(Ok(Error::EmptyArbitratorPool))
        );
    }

    #[test]
    fn finalize_before_the_window_closes_is_rejected() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        assert_eq!(
            setup.client().try_finalize_dispute(&setup.admin, &0),
            Err(Ok(Error::VotingNotOver))
        );
    }

    #[test]
    fn an_unanimous_release_vote_finalizes_to_release() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);

        setup.env.ledger().set_timestamp(100 + dispute_window() + 1);
        assert_eq!(
            setup.client().finalize_dispute(&setup.investor_a, &0),
            DisputeOutcome::Release
        );
    }

    #[test]
    fn a_window_that_closes_without_votes_resolves_to_refund() {
        // Escrowed principal is never paid out without an affirmative
        // decision: silence from the arbitrators protects the investors.
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        // The deadline is inclusive for voting, so the window is still open at
        // exactly `voting_deadline` and cannot be finalized yet.
        setup.env.ledger().set_timestamp(100 + dispute_window());
        assert_eq!(
            setup.client().try_finalize_dispute(&setup.investor_a, &0),
            Err(Ok(Error::VotingNotOver))
        );

        setup.env.ledger().set_timestamp(100 + dispute_window() + 1);
        assert_eq!(
            setup.client().finalize_dispute(&setup.investor_a, &0),
            DisputeOutcome::Refund
        );
        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.phase, DisputePhase::Verdict);

        assert_eq!(
            setup.client().try_cast_dispute_vote(&setup.arbitrator, &0, &true),
            Err(Ok(Error::DisputeDecided))
        );
    }

    #[test]
    fn a_vote_cast_exactly_at_the_deadline_still_counts() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        setup.env.ledger().set_timestamp(100 + dispute_window());
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);

        let dispute = setup.client().get_dispute(&0).expect("dispute recorded");
        assert_eq!(dispute.release_votes, 1);
        assert_eq!(dispute.outcome(), Some(DisputeOutcome::Release));
    }

    #[test]
    fn a_tie_resolves_to_refund() {
        let setup = setup_campaign(100, 150);
        let arb_b = Address::generate(&setup.env);
        let pool = Vec::from_array(&setup.env, [setup.arbitrator.clone(), arb_b.clone()]);
        setup.client().set_arbitrator_pool(&setup.admin, &pool);

        advance_to_active(&setup);
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);
        setup.client().cast_dispute_vote(&arb_b, &0, &false);

        setup.env.ledger().set_timestamp(100 + dispute_window() + 1);
        assert_eq!(
            setup.client().finalize_dispute(&setup.investor_a, &0),
            DisputeOutcome::Refund
        );
    }

    #[test]
    fn release_outcome_pays_the_farmer_the_disputed_tranche() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);

        let outcome = setup.client().resolve_dispute(&setup.arbitrator, &0);
        assert_eq!(outcome, DisputeOutcome::Release);

        // 100 raised, 2% platform fee, 3 milestones => tranche of 98/3.
        let tranche = 98 / 3;
        assert_eq!(setup.usdc().balance(&setup.farmer), tranche);
        let state = setup.client().get_state();
        assert_eq!(state.milestones_released, 1);
        assert_eq!(state.total_released, tranche);
        assert!(!setup.client().has_dispute(&0));
        assert_eq!(
            setup.client().get_dispute(&0).expect("dispute kept for indexing").phase,
            DisputePhase::Resolved
        );
    }

    #[test]
    fn refund_outcome_makes_the_remaining_escrow_refundable() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &false);

        assert_eq!(
            setup.client().resolve_dispute(&setup.arbitrator, &0),
            DisputeOutcome::Refund
        );

        assert_eq!(setup.client().get_refundable_amount(&setup.investor_a), 60);
        assert_eq!(setup.client().get_refundable_amount(&setup.investor_b), 40);
        assert!(setup.client().is_raise_ended());

        setup.client().refund(&setup.investor_a);
        setup.client().refund(&setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 60);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 40);
    }

    #[test]
    fn resolving_twice_is_a_no_op_and_never_pays_twice() {
        // Outcome replay: an indexer retry or a second arbitrator click must
        // not move money a second time.
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);

        assert_eq!(setup.client().resolve_dispute(&setup.arbitrator, &0), DisputeOutcome::Release);
        let farmer_balance = setup.usdc().balance(&setup.farmer);

        assert_eq!(setup.client().resolve_dispute(&setup.admin, &0), DisputeOutcome::Release);
        assert_eq!(setup.client().resolve_dispute(&setup.arbitrator, &0), DisputeOutcome::Release);

        assert_eq!(setup.usdc().balance(&setup.farmer), farmer_balance);
        assert_eq!(setup.client().get_state().milestones_released, 1);
        // The milestone stays released even though the dispute is replayed.
        assert_eq!(
            setup.client().try_release_milestone(&setup.admin, &0),
            Err(Ok(Error::MilestoneAlreadyDone))
        );
    }

    #[test]
    fn resolving_without_a_verdict_requires_the_window_to_close() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        assert_eq!(
            setup.client().try_resolve_dispute(&setup.arbitrator, &0),
            Err(Ok(Error::VotingNotOver))
        );

        setup.env.ledger().set_timestamp(100 + dispute_window() + 1);
        assert_eq!(
            setup.client().resolve_dispute(&setup.arbitrator, &0),
            DisputeOutcome::Refund
        );
    }

    #[test]
    fn resolve_is_limited_to_arbitrators_and_the_admin() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);
        let stranger = Address::generate(&setup.env);

        assert_eq!(
            setup.client().try_resolve_dispute(&stranger, &0),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn evidence_cannot_be_added_after_the_verdict() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        setup.client().cast_dispute_vote(&setup.arbitrator, &0, &true);

        let uri = String::from_str(&setup.env, "ipfs://too-late");
        assert_eq!(
            setup.client().try_submit_dispute_evidence(&setup.farmer, &0, &uri),
            Err(Ok(Error::DisputeDecided))
        );
    }

    #[test]
    fn empty_evidence_references_are_rejected() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);
        let empty = String::from_str(&setup.env, "");

        assert_eq!(
            setup.client().try_submit_dispute_evidence(&setup.admin, &0, &empty),
            Err(Ok(Error::InvalidEvidence))
        );
    }

    #[test]
    fn only_one_dispute_can_be_open_per_milestone() {
        let setup = active_campaign();
        setup.client().raise_dispute(&setup.admin, &0);

        assert_eq!(
            setup.client().try_raise_dispute(&setup.farmer, &0),
            Err(Ok(Error::DisputeActive))
        );
    }

    #[test]
    fn disputes_cannot_be_raised_on_unreleased_or_unknown_milestones() {
        let setup = active_campaign();

        assert_eq!(
            setup.client().try_raise_dispute(&setup.admin, &3),
            Err(Ok(Error::MilestoneNotFound))
        );

        setup.client().release_milestone(&setup.admin, &0);
        assert_eq!(
            setup.client().try_raise_dispute(&setup.admin, &0),
            Err(Ok(Error::MilestoneAlreadyDone))
        );
    }

    #[test]
    fn disputes_require_an_active_campaign() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 60);
        invest(&setup, &setup.investor_b, 40);

        // Funded but not yet approved to Active.
        assert_eq!(
            setup.client().try_raise_dispute(&setup.admin, &0),
            Err(Ok(Error::NotFunded))
        );
    }

    #[test]
    fn the_voting_window_is_configurable_and_pinned_when_the_dispute_opens() {
        let setup = setup_campaign(100, 150);
        setup.client().set_dispute_voting_window(&setup.admin, &600);
        assert_eq!(setup.client().get_dispute_voting_window(), 600);

        advance_to_active(&setup);
        setup.client().raise_dispute(&setup.admin, &0);
        assert_eq!(
            setup.client().get_dispute_voting_deadline(&0),
            Some(100 + 600)
        );

        // Retracing the window later must not move a live dispute's deadline.
        setup.client().set_dispute_voting_window(&setup.admin, &3600);
        assert_eq!(
            setup.client().get_dispute_voting_deadline(&0),
            Some(100 + 600)
        );
        setup.env.ledger().set_timestamp(100 + 601);
        assert_eq!(
            setup.client().try_cast_dispute_vote(&setup.arbitrator, &0, &true),
            Err(Ok(Error::VotingWindowClosed))
        );
    }

    #[test]
    fn voting_window_cannot_be_zero_and_only_admin_sets_it() {
        let setup = setup_campaign(100, 150);

        assert_eq!(
            setup.client().try_set_dispute_voting_window(&setup.admin, &0),
            Err(Ok(Error::InvalidAmount))
        );
        assert_eq!(
            setup.client().try_set_dispute_voting_window(&setup.farmer, &600),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn resolving_the_last_milestone_marks_the_campaign_delivered() {
        let setup = active_campaign();

        setup.client().release_milestone(&setup.admin, &0);
        setup.client().release_milestone(&setup.admin, &1);
        setup.client().raise_dispute(&setup.investor_a, &2);
        setup.client().cast_dispute_vote(&setup.arbitrator, &2, &true);

        assert_eq!(setup.client().resolve_dispute(&setup.arbitrator, &2), DisputeOutcome::Release);
        assert!(setup.client().get_state().status == CampaignStatus::Delivered);
    }
}
