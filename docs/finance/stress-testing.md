# Stress Testing and Scenario Analysis

This document describes the stress testing and scenario analysis system for portfolio resilience. The system simulates adverse market conditions (commodity price crashes, supply chain disruptions, geopolitical events) to test portfolio resilience and identify vulnerabilities, enabling proactive risk management.

## Overview

The stress testing system provides:

- A **scenario library** of pre-defined stress scenarios
- **Custom scenario creation** for user-defined stress conditions
- **Portfolio impact simulation** under scenarios
- **Stress test reporting** on portfolio resilience
- **Scenario comparison** across multiple scenarios
- **Stress test alerts** when loss thresholds are exceeded
- **Historical stress testing** against real historical crises
- **Reverse stress testing** to identify failure scenarios
- **Scheduled stress tests** for automated regular testing

The system uses existing portfolio data for simulation, leverages existing market data for scenario parameters, and integrates with existing analytics for reporting.

## Scenario Library

The scenario library contains pre-defined stress scenarios grouped into three categories:

### Price Crash Scenarios

Simulate sharp declines in commodity prices:

| Scenario | Description | Typical Shock |
|----------|-------------|---------------|
| `price_crash_mild` | Moderate commodity price decline | -10% |
| `price_crash_severe` | Severe commodity price crash | -30% |
| `price_crash_extreme` | Extreme market collapse | -50% |

### Supply Disruption Scenarios

Simulate disruptions to supply chains:

| Scenario | Description | Typical Shock |
|----------|-------------|---------------|
| `supply_disruption_regional` | Regional supply disruption | +15% cost, -10% volume |
| `supply_disruption_global` | Global supply chain disruption | +40% cost, -30% volume |

### Geopolitical Scenarios

Simulate geopolitical events affecting markets:

| Scenario | Description | Typical Shock |
|----------|-------------|---------------|
| `geopolitical_regional` | Regional geopolitical tension | -15% prices, +10% volatility |
| `geopolitical_global` | Major global geopolitical event | -35% prices, +50% volatility |

Each scenario defines a set of **shocks** applied to portfolio positions. Shocks can target:

- **Price shocks** — percentage change applied to position prices
- **Volume shocks** — percentage change applied to position volumes
- **Cost shocks** — percentage change applied to position costs
- **Volatility shocks** — change to market volatility used in valuation

## Custom Scenario Creation

Users can create custom stress scenarios by defining:

- A unique scenario name and description
- A category (price crash, supply disruption, geopolitical, or custom)
- One or more shocks, each specifying:
  - The shock type (`price`, `volume`, `cost`, `volatility`)
  - The magnitude (percentage change)
  - An optional target filter (e.g., specific commodity, region, or position)

Custom scenarios are stored alongside the library scenarios and can be used in simulation, comparison, and reporting just like pre-defined scenarios.

Example custom scenario definition:

```json
{
  "name": "custom_energy_crisis",
  "description": "Energy price spike with demand collapse",
  "category": "custom",
  "shocks": [
    { "type": "price", "magnitude": 0.60, "target": { "commodity": "energy" } },
    { "type": "volume", "magnitude": -0.25, "target": { "commodity": "energy" } }
  ]
}
```

## Portfolio Impact Simulation

The simulation engine applies scenario shocks to the current portfolio and computes the resulting portfolio value and performance metrics.

### Methodology

1. **Load portfolio** — retrieve current positions (commodity, quantity, price, cost, region).
2. **Apply shocks** — for each position, apply matching shocks from the scenario:
   - Price shock: `new_price = price * (1 + price_shock)`
   - Volume shock: `new_quantity = quantity * (1 + volume_shock)`
   - Cost shock: `new_cost = cost * (1 + cost_shock)`
   - Volatility shock: adjusts valuation volatility assumptions
3. **Revalue portfolio** — compute stressed position values and total portfolio value.
4. **Compute impact metrics**:
   - Absolute loss: `stressed_value - baseline_value`
   - Percentage loss: `(stressed_value - baseline_value) / baseline_value`
   - Position-level impacts for vulnerability identification

Shocks are applied multiplicatively and compounded when multiple shocks of the same type target a position.

### Simulation Output

Each simulation produces a result containing:

- Scenario name and category
- Baseline portfolio value
- Stressed portfolio value
- Absolute and percentage loss
- Per-position impact breakdown
- Pass/fail status against configured loss thresholds

## Stress Test Reporting

The reporting module generates resilience reports from simulation results. A report includes:

- **Summary** — overall portfolio resilience verdict (pass/fail)
- **Scenario results** — loss and impact for each scenario tested
- **Vulnerability analysis** — positions with the largest negative impacts
- **Threshold breaches** — scenarios that exceeded loss thresholds
- **Recommendations** — flagged concentrations and exposures

Reports integrate with existing analytics and can be generated on demand or as part of scheduled runs.

## Scenario Comparison

The comparison module runs multiple scenarios against the same portfolio and produces a comparative view:

- Ranked list of scenarios by portfolio loss (worst to best)
- Side-by-side loss metrics per scenario
- Identification of the most damaging scenario
- Per-category comparison (price crash vs. supply disruption vs. geopolitical)

This allows users to understand which adverse conditions pose the greatest risk to the portfolio.

## Stress Test Alerts

The alerting module evaluates simulation results against configured loss thresholds and raises alerts when thresholds are breached.

### Alert Configuration

- **Warning threshold** — percentage loss that triggers a warning alert
- **Critical threshold** — percentage loss that triggers a critical alert
- **Per-scenario overrides** — optional scenario-specific thresholds

### Alert Behavior

When a simulation result exceeds a threshold, an alert is generated containing:

- Scenario name and category
- Actual loss vs. threshold
- Severity (warning or critical)
- Timestamp

Alerts can be consumed by existing notification infrastructure.

## Historical Stress Testing

Historical stress testing replays real historical crises against the current portfolio. Each historical scenario encodes the market shocks observed during a past crisis:

| Historical Scenario | Description |
|---------------------|-------------|
| `historical_2008_financial_crisis` | Global financial crisis market shocks |
| `historical_2020_covid_crash` | COVID-19 market crash |
| `historical_2022_commodity_shock` | 2022 commodity price shock |

Historical scenarios use the same simulation engine as library and custom scenarios, allowing direct comparison between hypothetical and historical stress results.

## Reverse Stress Testing

Reverse stress testing works backwards from a failure condition to identify the scenarios that would cause it.

### Methodology

1. Define a **failure threshold** (e.g., portfolio loss exceeding a critical percentage).
2. For each shock dimension (price, volume, cost), determine the shock magnitude required to breach the failure threshold.
3. Report the **breakeven shocks** — the adverse conditions that would cause portfolio failure.

### Output

Reverse stress test results include:

- The failure threshold used
- For each dimension, the shock magnitude that causes failure
- The most sensitive dimension (the smallest shock that causes failure)
- Interpretation guidance for risk management

This helps identify hidden vulnerabilities and the magnitude of adverse conditions the portfolio cannot withstand.

## Stress Test Scheduling

The scheduling module automates regular stress tests. A schedule defines:

- The scenarios to run (library, custom, historical, or all)
- The frequency (e.g., daily, weekly, monthly)
- Whether to generate reports and raise alerts

Scheduled runs execute the simulation, generate reports, evaluate alerts, and record results for trend analysis. Schedules can be managed programmatically through the stress testing API.

## Configuration

Stress testing behavior is controlled through configuration:

| Setting | Description | Default |
|---------|-------------|---------|
| `stress_test.enabled` | Enable/disable stress testing | `true` |
| `stress_test.warning_threshold` | Warning loss threshold (fraction) | `0.10` |
| `stress_test.critical_threshold` | Critical loss threshold (fraction) | `0.25` |
| `stress_test.default_scenarios` | Scenarios run by default | library scenarios |
| `stress_test.schedule.frequency` | Default schedule frequency | `weekly` |
| `stress_test.reverse.failure_threshold` | Reverse stress failure threshold | `0.25` |

## Usage Example

```python
from finance.stress_testing import StressTestEngine, ScenarioLibrary

engine = StressTestEngine(portfolio=portfolio)

# Run a library scenario
result = engine.simulate(ScenarioLibrary.get("price_crash_severe"))

# Create and run a custom scenario
custom = engine.create_custom_scenario(
    name="custom_energy_crisis",
    category="custom",
    shocks=[{"type": "price", "magnitude": 0.60, "target": {"commodity": "energy"}}],
)
result = engine.simulate(custom)

# Compare scenarios
comparison = engine.compare(["price_crash_severe", "supply_disruption_global", custom.name])

# Generate a resilience report
report = engine.generate_report(comparison)

# Reverse stress test
reverse = engine.reverse_stress_test(failure_threshold=0.25)

# Schedule regular tests
engine.schedule(scenarios="all", frequency="weekly")
```

## Best Practices

- Run stress tests regularly (at minimum weekly) and after significant portfolio changes.
- Combine library, historical, and reverse stress tests for comprehensive coverage.
- Review alerts promptly and investigate threshold breaches.
- Use scenario comparison to prioritize risk mitigation efforts.
- Tune thresholds to reflect the organization's risk appetite.
- Document custom scenarios so their assumptions remain transparent.