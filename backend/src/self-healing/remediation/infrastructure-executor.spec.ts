import {
  NoopInfrastructureExecutor,
  InfrastructureExecutor,
} from './infrastructure-executor';
import { AnsibleInfrastructureExecutor } from './ansible-executor';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('NoopInfrastructureExecutor', () => {
  const executor = new NoopInfrastructureExecutor();

  it('is named noop', () => {
    expect(executor.name).toBe('noop');
  });

  it('does not support any action', () => {
    expect(executor.supports('restart_pod')).toBe(false);
    expect(executor.supports('cleanup_disk')).toBe(false);
  });

  it('reports every action as unsupported', async () => {
    const results = [
      await executor.restartPod('agri-fi/backend-1', {} as never),
      await executor.restartService('agri-fi/backend', {} as never),
      await executor.cleanupDisk('node-1', {} as never),
      await executor.scaleDeployment('agri-fi/backend', 3, {} as never),
    ];

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.unsupported).toBe(true);
    }
  });

  it('cannot resolve the current replica count', async () => {
    expect(await executor.getCurrentReplicas('agri-fi/backend')).toBeNull();
  });
});

describe('AnsibleInfrastructureExecutor', () => {
  let playbookPath: string;

  const buildExecutor = (playbook: string) =>
    new AnsibleInfrastructureExecutor({
      get: jest.fn((key: string, fallback?: string) =>
        key === 'SELF_HEALING_ANSIBLE_PLAYBOOK' ? playbook : fallback,
      ),
    } as never);

  beforeEach(() => {
    playbookPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'self-healing-playbook-')),
      'remediation.yml',
    );
    fs.writeFileSync(playbookPath, '---\n');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(playbookPath), { recursive: true, force: true });
  });

  it('supports the host level actions', () => {
    const executor = buildExecutor(playbookPath);

    expect(executor.supports('cleanup_disk')).toBe(true);
    expect(executor.supports('restart_service')).toBe(true);
  });

  it('refuses a target with unsupported characters', async () => {
    const executor = buildExecutor(playbookPath);

    const result = await executor.restartService('node-1; rm -rf /', {
      namespace: 'agri-fi',
      timeoutMs: 1000,
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('unsupported characters');
  });

  it('reports a missing playbook', async () => {
    const executor = buildExecutor('/tmp/does-not-exist.yml');

    const result = await executor.cleanupDisk('node-1', {
      namespace: 'agri-fi',
      timeoutMs: 1000,
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('playbook not found');
  });

  it('does not touch the infrastructure in dry run mode', async () => {
    const executor = buildExecutor(playbookPath);

    const result = await executor.cleanupDisk('node-1', {
      namespace: 'agri-fi',
      timeoutMs: 1000,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Dry run');
  });

  it('cannot resolve the current replica count', async () => {
    const executor = buildExecutor(playbookPath);

    expect(await executor.getCurrentReplicas('agri-fi/backend')).toBeNull();
  });
});

describe('InfrastructureExecutor contract', () => {
  it('is implemented by the no-op executor', () => {
    const executor: InfrastructureExecutor = new NoopInfrastructureExecutor();
    expect(executor.name).toBe('noop');
  });
});
