#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, Symbol,
};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized         = 1,
    NotInitialized       = 2,
    AlreadyInitialized   = 3,
    InsufficientStake    = 4,
    NothingStaked        = 5,
    SlashExceedsStake    = 6,
    InvalidScore         = 7,
    UserNotFound         = 8,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    StakeToken,
    /// Staked token balance per user.
    Stake(Address),
    /// On-chain reputation score (0–1000) per user.
    Score(Address),
    /// Cumulative rewards earned per user (in token units).
    Rewards(Address),
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Minimum stake required to participate in the reputation system.
const MIN_STAKE: i128 = 1_000_0000000; // 1 000 tokens (7 decimals)
/// Points added to reputation score for a positive event (e.g. on-time delivery).
const REWARD_SCORE_DELTA: i64 = 10;
/// Points deducted from reputation score for a negative event (e.g. default).
const SLASH_SCORE_DELTA: i64 = 30;
/// Maximum possible reputation score.
const MAX_SCORE: i64 = 1_000;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the contract.  Must be called once by the deployer.
    pub fn initialize(env: Env, admin: Address, stake_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        Ok(())
    }

    // ── Staking ──────────────────────────────────────────────────────────────

    /// Stake tokens to join the reputation system.  The caller authorises the
    /// transfer from their account to this contract.
    pub fn stake(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        Self::require_init(&env)?;
        user.require_auth();
        if amount < MIN_STAKE {
            return Err(Error::InsufficientStake);
        }

        let token = Self::stake_token(&env);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&user, &env.current_contract_address(), &amount);

        let current: i128 = env.storage().persistent().get(&DataKey::Stake(user.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Stake(user.clone()), &(current + amount));

        // Initialise score to 500 on first stake.
        if !env.storage().persistent().has(&DataKey::Score(user.clone())) {
            env.storage().persistent().set(&DataKey::Score(user.clone()), &500i64);
        }

        env.events().publish((Symbol::new(&env, "staked"),), (user, amount));
        Ok(())
    }

    /// Withdraw staked tokens (full amount only, disables participation).
    pub fn unstake(env: Env, user: Address) -> Result<i128, Error> {
        Self::require_init(&env)?;
        user.require_auth();

        let staked: i128 = env.storage().persistent().get(&DataKey::Stake(user.clone()))
            .ok_or(Error::NothingStaked)?;
        if staked == 0 {
            return Err(Error::NothingStaked);
        }

        env.storage().persistent().remove(&DataKey::Stake(user.clone()));
        env.storage().persistent().remove(&DataKey::Score(user.clone()));

        let token = Self::stake_token(&env);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&env.current_contract_address(), &user, &staked);

        env.events().publish((Symbol::new(&env, "unstaked"),), (user, staked));
        Ok(staked)
    }

    // ── Reputation management ────────────────────────────────────────────────

    /// Award reputation points and token rewards for positive behaviour.
    /// Only callable by admin (e.g. milestone oracle).
    pub fn reward(env: Env, caller: Address, user: Address, token_amount: i128) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let score = Self::get_score_internal(&env, &user)?;
        let new_score = (score + REWARD_SCORE_DELTA).min(MAX_SCORE);
        env.storage().persistent().set(&DataKey::Score(user.clone()), &new_score);

        let earned: i128 = env.storage().persistent().get(&DataKey::Rewards(user.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Rewards(user.clone()), &(earned + token_amount));

        env.events().publish((Symbol::new(&env, "rewarded"),), (user, new_score, token_amount));
        Ok(())
    }

    /// Slash staked tokens and reduce reputation score for misconduct.
    /// Only callable by admin.
    pub fn slash(env: Env, caller: Address, user: Address, slash_amount: i128) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let staked: i128 = env.storage().persistent().get(&DataKey::Stake(user.clone()))
            .ok_or(Error::NothingStaked)?;
        if slash_amount > staked {
            return Err(Error::SlashExceedsStake);
        }

        env.storage().persistent().set(&DataKey::Stake(user.clone()), &(staked - slash_amount));

        let score = Self::get_score_internal(&env, &user)?;
        let new_score = (score - SLASH_SCORE_DELTA).max(0);
        env.storage().persistent().set(&DataKey::Score(user.clone()), &new_score);

        env.events().publish((Symbol::new(&env, "slashed"),), (user, new_score, slash_amount));
        Ok(())
    }

    // ── Read-only ────────────────────────────────────────────────────────────

    /// Returns the current reputation score for a user (0–1000).
    pub fn get_score(env: Env, user: Address) -> Result<i64, Error> {
        Self::require_init(&env)?;
        Self::get_score_internal(&env, &user)
    }

    /// Returns the amount of tokens staked by a user.
    pub fn get_stake(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Stake(user)).unwrap_or(0)
    }

    /// Returns the cumulative token rewards earned by a user.
    pub fn get_rewards(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Rewards(user)).unwrap_or(0)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn require_init(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::require_init(env)?;
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn stake_token(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::StakeToken).unwrap()
    }

    fn get_score_internal(env: &Env, user: &Address) -> Result<i64, Error> {
        env.storage().persistent()
            .get(&DataKey::Score(user.clone()))
            .ok_or(Error::UserNotFound)
    }
}
