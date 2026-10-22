#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, Env};

fn deploy(env: &Env) -> (Address, Address, Address, Address) {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let user = Address::generate(env);

    let token_addr = env.register_stellar_asset_contract(admin.clone());
    let token_client = token::Client::new(env, &token_addr);
    // Mint enough for tests
    token::StellarAssetClient::new(env, &token_addr)
        .mint(&user, &100_000_0000000i128);

    let contract_id = env.register_contract(None, ReputationContract);
    ReputationContractClient::new(env, &contract_id)
        .initialize(&admin, &token_addr);

    (contract_id, admin, user, token_addr)
}

#[test]
fn stake_sets_initial_score_to_500() {
    let env = Env::default();
    let (contract_id, _admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    client.stake(&user, &MIN_STAKE);
    assert_eq!(client.get_score(&user), Ok(500));
}

#[test]
fn stake_below_minimum_is_rejected() {
    let env = Env::default();
    let (contract_id, _admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    let result = client.try_stake(&user, &(MIN_STAKE - 1));
    assert_eq!(result, Err(Ok(Error::InsufficientStake)));
}

#[test]
fn reward_increases_score() {
    let env = Env::default();
    let (contract_id, admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    client.stake(&user, &MIN_STAKE);
    let before = client.get_score(&user).unwrap();
    client.reward(&admin, &user, &0i128);
    let after = client.get_score(&user).unwrap();
    assert!(after > before);
}

#[test]
fn slash_decreases_score_and_stake() {
    let env = Env::default();
    let (contract_id, admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    client.stake(&user, &MIN_STAKE);
    let slash_amount = MIN_STAKE / 2;
    client.slash(&admin, &user, &slash_amount);

    assert_eq!(client.get_stake(&user), MIN_STAKE - slash_amount);
    assert!(client.get_score(&user).unwrap() < 500);
}

#[test]
fn non_admin_cannot_reward_or_slash() {
    let env = Env::default();
    let (contract_id, _admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);
    let non_admin = Address::generate(&env);

    client.stake(&user, &MIN_STAKE);

    assert_eq!(
        client.try_reward(&non_admin, &user, &0i128),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        client.try_slash(&non_admin, &user, &1i128),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn unstake_returns_remaining_tokens_and_removes_score() {
    let env = Env::default();
    let (contract_id, _admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    client.stake(&user, &MIN_STAKE);
    let returned = client.unstake(&user).unwrap();
    assert_eq!(returned, MIN_STAKE);
    assert_eq!(client.get_stake(&user), 0);
    assert_eq!(client.try_get_score(&user), Err(Ok(Error::UserNotFound)));
}

#[test]
fn score_is_capped_at_max() {
    let env = Env::default();
    let (contract_id, admin, user, _token) = deploy(&env);
    let client = ReputationContractClient::new(&env, &contract_id);

    client.stake(&user, &MIN_STAKE);
    // Apply 60 reward events; score would reach 500 + 60*10 = 1100 without cap.
    for _ in 0..60 {
        client.reward(&admin, &user, &0i128);
    }
    assert_eq!(client.get_score(&user).unwrap(), MAX_SCORE);
}
