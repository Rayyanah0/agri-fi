#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

struct Setup {
    env: Env,
    contract_id: Address,
    admin: Address,
    oracle: Address,
    feed: String,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let contract_id = env.register_contract(None, PriceFeedContract);
    let client = PriceFeedContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let feed = String::from_str(&env, "COCOA/USD");
    client.configure_feed(&admin, &feed, &7u32, &3600u64, &1000u32);
    client.set_oracle(&admin, &feed, &oracle, &true);

    Setup { env, contract_id, admin, oracle, feed }
}

fn client<'a>(setup: &'a Setup) -> PriceFeedContractClient<'a> {
    PriceFeedContractClient::new(&setup.env, &setup.contract_id)
}

// ── Discriminant bindings ─────────────────────────────────────────────────────

#[test]
fn test_error_discriminants_are_unique_and_stable() {
    assert_eq!(Error::Unauthorized as u32, 1);
    assert_eq!(Error::NotInitialized as u32, 2);
    assert_eq!(Error::AlreadyInitialized as u32, 3);
    assert_eq!(Error::Paused as u32, 4);
    assert_eq!(Error::FeedNotConfigured as u32, 5);
    assert_eq!(Error::OracleNotAllowed as u32, 6);
    assert_eq!(Error::InvalidPrice as u32, 7);
    assert_eq!(Error::StalePrice as u32, 8);
    assert_eq!(Error::DeviationTooHigh as u32, 9);
    assert_eq!(Error::RoundNotIncreasing as u32, 10);
    assert_eq!(Error::InvalidConfig as u32, 11);
    assert_eq!(Error::InvalidFeedId as u32, 12);
    assert_eq!(Error::PriceNotFound as u32, 13);
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let setup = setup();
    assert_eq!(client(&setup).get_admin(), setup.admin);
    assert!(!client(&setup).is_paused());
}

#[test]
fn test_double_initialize_fails() {
    let setup = setup();
    let res = client(&setup).try_initialize(&setup.admin);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

// ── Feed configuration ────────────────────────────────────────────────────────

#[test]
fn test_configure_feed_stores_config() {
    let setup = setup();
    let cfg = client(&setup).get_feed_config(&setup.feed);
    assert_eq!(cfg.decimals, 7);
    assert_eq!(cfg.heartbeat_secs, 3600);
    assert_eq!(cfg.max_deviation_bps, 1000);
}

#[test]
fn test_configure_feed_rejects_invalid_values() {
    let setup = setup();
    let feed = String::from_str(&setup.env, "BAD/USD");
    assert_eq!(
        client(&setup).try_configure_feed(&setup.admin, &feed, &19u32, &60u64, &100u32),
        Err(Ok(Error::InvalidConfig)),
    );
    assert_eq!(
        client(&setup).try_configure_feed(&setup.admin, &feed, &7u32, &0u64, &100u32),
        Err(Ok(Error::InvalidConfig)),
    );
    assert_eq!(
        client(&setup).try_configure_feed(
            &setup.admin,
            &feed,
            &7u32,
            &60u64,
            &(MAX_DEVIATION_BPS + 1)
        ),
        Err(Ok(Error::InvalidConfig)),
    );
}

#[test]
fn test_configure_feed_rejects_empty_id() {
    let setup = setup();
    let empty = String::from_str(&setup.env, "");
    assert_eq!(
        client(&setup).try_configure_feed(&setup.admin, &empty, &7u32, &60u64, &100u32),
        Err(Ok(Error::InvalidFeedId)),
    );
}

#[test]
fn test_only_admin_can_configure() {
    let setup = setup();
    let other = Address::generate(&setup.env);
    let feed = String::from_str(&setup.env, "OTHER/USD");
    assert_eq!(
        client(&setup).try_configure_feed(&other, &feed, &7u32, &60u64, &100u32),
        Err(Ok(Error::Unauthorized)),
    );
}

// ── Oracle governance ─────────────────────────────────────────────────────────

#[test]
fn test_set_oracle_requires_configured_feed() {
    let setup = setup();
    let unknown = String::from_str(&setup.env, "MISSING/USD");
    let oracle = Address::generate(&setup.env);
    assert_eq!(
        client(&setup).try_set_oracle(&setup.admin, &unknown, &oracle, &true),
        Err(Ok(Error::FeedNotConfigured)),
    );
}

#[test]
fn test_set_oracle_toggles_allowlist() {
    let setup = setup();
    let oracle = Address::generate(&setup.env);
    assert!(!client(&setup).is_oracle_allowed(&setup.feed, &oracle));
    client(&setup).set_oracle(&setup.admin, &setup.feed, &oracle, &true);
    assert!(client(&setup).is_oracle_allowed(&setup.feed, &oracle));
    client(&setup).set_oracle(&setup.admin, &setup.feed, &oracle, &false);
    assert!(!client(&setup).is_oracle_allowed(&setup.feed, &oracle));
}

// ── Price submission ──────────────────────────────────────────────────────────

#[test]
fn test_submit_price_stores_reading() {
    let setup = setup();
    let data = client(&setup).submit_price(&setup.oracle, &setup.feed, &1_500_0000000i128, &1u64, &1000u64);
    assert_eq!(data.value, 1_500_0000000);
    assert_eq!(data.decimals, 7);
    assert_eq!(data.round_id, 1);

    let stored = client(&setup).get_price(&setup.feed);
    assert_eq!(stored.value, data.value);
    assert_eq!(stored.oracle, setup.oracle);
}

#[test]
fn test_submit_price_rejects_disallowed_oracle() {
    let setup = setup();
    let rogue = Address::generate(&setup.env);
    assert_eq!(
        client(&setup).try_submit_price(&rogue, &setup.feed, &100i128, &1u64, &1000u64),
        Err(Ok(Error::OracleNotAllowed)),
    );
}

#[test]
fn test_submit_price_rejects_non_positive_value() {
    let setup = setup();
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &setup.feed, &0i128, &1u64, &1000u64),
        Err(Ok(Error::InvalidPrice)),
    );
}

#[test]
fn test_submit_price_rejects_unknown_feed() {
    let setup = setup();
    let feed = String::from_str(&setup.env, "UNKNOWN/USD");
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &feed, &100i128, &1u64, &1000u64),
        Err(Ok(Error::FeedNotConfigured)),
    );
}

#[test]
fn test_submit_price_rejects_stale_round_and_timestamp() {
    let setup = setup();
    client(&setup).submit_price(&setup.oracle, &setup.feed, &1_000_0000000i128, &5u64, &1000u64);

    // Same round id.
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &setup.feed, &1_010_0000000i128, &5u64, &1100u64),
        Err(Ok(Error::RoundNotIncreasing)),
    );
    // Timestamp did not advance.
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &setup.feed, &1_010_0000000i128, &6u64, &1000u64),
        Err(Ok(Error::StalePrice)),
    );
}

#[test]
fn test_submit_price_rejects_excessive_deviation() {
    let setup = setup();
    // 1000 bps = 10%. First reading 100.
    client(&setup).submit_price(&setup.oracle, &setup.feed, &100_0000000i128, &1u64, &1000u64);
    // +20% should be rejected.
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &setup.feed, &120_0000000i128, &2u64, &2000u64),
        Err(Ok(Error::DeviationTooHigh)),
    );
    // +5% is accepted.
    let ok = client(&setup).submit_price(&setup.oracle, &setup.feed, &105_0000000i128, &3u64, &3000u64);
    assert_eq!(ok.round_id, 3);
}

#[test]
fn test_get_price_not_found() {
    let setup = setup();
    let feed = String::from_str(&setup.env, "EMPTY/USD");
    assert_eq!(client(&setup).try_get_price(&feed), Err(Ok(Error::PriceNotFound)));
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_submissions() {
    let setup = setup();
    client(&setup).pause(&setup.admin);
    assert!(client(&setup).is_paused());
    assert_eq!(
        client(&setup).try_submit_price(&setup.oracle, &setup.feed, &100i128, &1u64, &1000u64),
        Err(Ok(Error::Paused)),
    );
    client(&setup).unpause(&setup.admin);
    client(&setup).submit_price(&setup.oracle, &setup.feed, &100i128, &1u64, &1000u64);
}
