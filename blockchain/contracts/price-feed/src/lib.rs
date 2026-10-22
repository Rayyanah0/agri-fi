//! PriceFeed Soroban Smart Contract
//!
//! Issue #1235 — on-chain oracle data storage with validation and governance.
//!
//! External oracle providers (Chainlink, Band Protocol) push prices on-chain
//! through this contract.  It stores the latest reading per feed, enforces an
//! oracle allow-list, rejects stale round numbers, and bounds the price move
//! between consecutive rounds to catch bad data.
//!
//! ## Authenticity model
//!
//! An oracle is a Stellar account.  `submit_price` calls `require_auth` on the
//! submitting address *and* checks it against the per-feed allow-list, so only
//! governance-approved oracles can write and each write is cryptographically
//! signed by the transaction.
//!
//! ## Error discriminant map
//!
//! | Code | Variant             | Meaning                                        |
//! |------|---------------------|------------------------------------------------|
//! |  1   | Unauthorized        | Caller is not the admin or an allowed oracle   |
//! |  2   | NotInitialized      | Contract has not been initialised yet          |
//! |  3   | AlreadyInitialized  | `initialize` called more than once             |
//! |  4   | Paused              | Contract is administratively paused            |
//! |  5   | FeedNotConfigured   | No config exists for the feed                  |
//! |  6   | OracleNotAllowed    | Caller is not on the feed's oracle allow-list  |
//! |  7   | InvalidPrice        | Price is zero or negative                      |
//! |  8   | StalePrice          | Timestamp did not advance                      |
//! |  9   | DeviationTooHigh    | Move exceeds `max_deviation_bps`               |
//! | 10   | RoundNotIncreasing  | `round_id` is not greater than the last round  |
//! | 11   | InvalidConfig       | Feed configuration values are invalid          |
//! | 12   | InvalidFeedId       | Feed id string is empty                        |
//! | 13   | PriceNotFound       | No price has been submitted for the feed       |

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
};

/// Hard cap on the deviation bound an admin may configure (100%).
pub const MAX_DEVIATION_BPS: u32 = 10_000;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
    Paused = 4,
    FeedNotConfigured = 5,
    OracleNotAllowed = 6,
    InvalidPrice = 7,
    StalePrice = 8,
    DeviationTooHigh = 9,
    RoundNotIncreasing = 10,
    InvalidConfig = 11,
    InvalidFeedId = 12,
    PriceNotFound = 13,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    IsPaused,
    /// FeedConfig keyed by feed id (e.g. "XLM/USD", "COCOA/USD")
    FeedConfig(String),
    /// Latest PriceData keyed by feed id
    PriceData(String),
    /// Allow-list flag keyed by (feed id, oracle address)
    OracleAllowed(String, Address),
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Governance-configured parameters for a feed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeedConfig {
    pub feed_id: String,
    /// Number of decimals the integer `value` is scaled by.
    pub decimals: u32,
    /// Expected maximum age between rounds, in seconds.
    pub heartbeat_secs: u64,
    /// Maximum allowed move between rounds, in basis points.
    pub max_deviation_bps: u32,
}

/// A single on-chain oracle reading.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceData {
    pub value: i128,
    pub decimals: u32,
    pub round_id: u64,
    pub timestamp: u64,
    pub oracle: Address,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PriceFeedContract;

#[contractimpl]
impl PriceFeedContract {
    /// Initialises the contract with `admin`.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Governance ────────────────────────────────────────────────────────────

    /// Creates or updates a feed's parameters.  Admin only.
    pub fn configure_feed(
        env: Env,
        caller: Address,
        feed_id: String,
        decimals: u32,
        heartbeat_secs: u64,
        max_deviation_bps: u32,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        if feed_id.is_empty() {
            return Err(Error::InvalidFeedId);
        }
        if decimals > 18 || heartbeat_secs == 0 || max_deviation_bps > MAX_DEVIATION_BPS {
            return Err(Error::InvalidConfig);
        }

        let config = FeedConfig {
            feed_id: feed_id.clone(),
            decimals,
            heartbeat_secs,
            max_deviation_bps,
        };
        env.storage()
            .instance()
            .set(&DataKey::FeedConfig(feed_id.clone()), &config);
        env.events()
            .publish((symbol_short!("feed_cfg"), caller), feed_id);
        Ok(())
    }

    /// Adds (`allowed = true`) or removes an oracle from a feed's allow-list.
    /// Admin only — this is the oracle-selection governance hook.
    pub fn set_oracle(
        env: Env,
        caller: Address,
        feed_id: String,
        oracle: Address,
        allowed: bool,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        if !env
            .storage()
            .instance()
            .has(&DataKey::FeedConfig(feed_id.clone()))
        {
            return Err(Error::FeedNotConfigured);
        }
        env.storage()
            .instance()
            .set(&DataKey::OracleAllowed(feed_id.clone(), oracle.clone()), &allowed);
        env.events().publish(
            (symbol_short!("oracle"), caller),
            (feed_id, oracle, allowed),
        );
        Ok(())
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((symbol_short!("paused"),), caller);
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish((symbol_short!("unpaused"),), caller);
        Ok(())
    }

    // ── Oracle submissions ────────────────────────────────────────────────────

    /// Submits a validated price reading for `feed_id`.
    ///
    /// Validation performed:
    /// * caller is authenticated and on the feed's allow-list
    /// * `value` is strictly positive
    /// * `round_id` advances beyond the previous round
    /// * `timestamp` advances beyond the previous reading (stale-price guard)
    /// * the move versus the previous value is within `max_deviation_bps`
    pub fn submit_price(
        env: Env,
        oracle: Address,
        feed_id: String,
        value: i128,
        round_id: u64,
        timestamp: u64,
    ) -> Result<PriceData, Error> {
        oracle.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        if value <= 0 {
            return Err(Error::InvalidPrice);
        }

        let config: FeedConfig = env
            .storage()
            .instance()
            .get(&DataKey::FeedConfig(feed_id.clone()))
            .ok_or(Error::FeedNotConfigured)?;

        let allowed: bool = env
            .storage()
            .instance()
            .get(&DataKey::OracleAllowed(feed_id.clone(), oracle.clone()))
            .unwrap_or(false);
        if !allowed {
            return Err(Error::OracleNotAllowed);
        }

        if let Some(prev) = env
            .storage()
            .instance()
            .get::<DataKey, PriceData>(&DataKey::PriceData(feed_id.clone()))
        {
            if round_id <= prev.round_id {
                return Err(Error::RoundNotIncreasing);
            }
            if timestamp <= prev.timestamp {
                return Err(Error::StalePrice);
            }
            let diff = if value > prev.value {
                value - prev.value
            } else {
                prev.value - value
            };
            let deviation_bps = diff.saturating_mul(MAX_DEVIATION_BPS as i128) / prev.value;
            if deviation_bps > config.max_deviation_bps as i128 {
                return Err(Error::DeviationTooHigh);
            }
        }

        let data = PriceData {
            value,
            decimals: config.decimals,
            round_id,
            timestamp,
            oracle: oracle.clone(),
        };
        env.storage()
            .instance()
            .set(&DataKey::PriceData(feed_id.clone()), &data);

        env.events().publish(
            (symbol_short!("price"), oracle),
            (feed_id, value, round_id, timestamp),
        );
        Ok(data)
    }

    // ── View methods ──────────────────────────────────────────────────────────

    /// Returns the latest price for `feed_id`, or `PriceNotFound` (13).
    pub fn get_price(env: Env, feed_id: String) -> Result<PriceData, Error> {
        env.storage()
            .instance()
            .get(&DataKey::PriceData(feed_id))
            .ok_or(Error::PriceNotFound)
    }

    pub fn get_feed_config(env: Env, feed_id: String) -> Result<FeedConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::FeedConfig(feed_id))
            .ok_or(Error::FeedNotConfigured)
    }

    pub fn is_oracle_allowed(env: Env, feed_id: String, oracle: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::OracleAllowed(feed_id, oracle))
            .unwrap_or(false)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::IsPaused)
            .unwrap_or(false)
        {
            return Err(Error::Paused);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != &admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
