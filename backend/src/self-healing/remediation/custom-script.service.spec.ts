import { CustomScriptService } from './custom-script.service';
import { RemediationScript } from '../entities/remediation-script.entity';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('CustomScriptService', () => {
  let service: CustomScriptService;
  let scriptRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let configMock: { get: jest.Mock };
  let scriptsDir: string;

  const buildScript = (
    overrides: Partial<RemediationScript> = {},
  ): RemediationScript => {
    const script = new RemediationScript();
    script.id = 'script-1';
    script.name = 'cleanup-disk';
    script.issueType = 'disk_full';
    script.description = null;
    script.scriptPath = 'cleanup-disk.sh';
    script.interpreter = 'bash';
    script.timeoutSeconds = 30;
    script.defaultArgsJson = [];
    script.enabled = true;
    script.requiresApproval = true;
    script.destructive = true;
    script.allowedEnvironmentsJson = ['staging', 'production'];
    script.version = 1;
    script.lastRunAt = null;
    script.lastResult = null;
    return Object.assign(script, overrides);
  };

  beforeEach(() => {
    scriptsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'self-healing-scripts-'),
    );

    scriptRepoMock = {
      create: jest.fn((entry) => ({ ...entry })),
      save: jest.fn(async (entry) => ({ id: 'script-1', ...entry })),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      update: jest.fn(async () => undefined),
    };

    configMock = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'SELF_HEALING_SCRIPTS_DIR' ? scriptsDir : fallback,
      ),
    };

    service = new CustomScriptService(
      scriptRepoMock as never,
      configMock as never,
    );
  });

  afterEach(() => {
    fs.rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('resolves a script that lives inside the scripts directory', () => {
    fs.writeFileSync(path.join(scriptsDir, 'cleanup-disk.sh'), '#!/bin/bash\n');

    const resolved = service.resolveScriptPath(buildScript());

    expect(resolved).toBe(path.join(scriptsDir, 'cleanup-disk.sh'));
  });

  it('refuses a script that escapes the scripts directory', () => {
    const resolved = service.resolveScriptPath(
      buildScript({ scriptPath: '../../etc/passwd' }),
    );

    expect(resolved).toBeNull();
  });

  it('refuses a script that does not exist', () => {
    expect(service.resolveScriptPath(buildScript())).toBeNull();
  });

  it('does not run a disabled script', async () => {
    const result = await service.run(buildScript({ enabled: false }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('is disabled');
  });

  it('does not run a script with an interpreter that is not allowed', async () => {
    fs.writeFileSync(path.join(scriptsDir, 'cleanup-disk.sh'), '#!/bin/bash\n');

    const result = await service.run(buildScript({ interpreter: 'node' }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('is not allowed');
  });

  it('does not run a script with unsafe arguments', async () => {
    fs.writeFileSync(path.join(scriptsDir, 'cleanup-disk.sh'), '#!/bin/bash\n');

    const result = await service.run(buildScript(), ['node-1; rm -rf /']);

    expect(result.success).toBe(false);
    expect(result.message).toContain('unsupported characters');
  });

  it('runs a registered script and captures its output', async () => {
    fs.writeFileSync(
      path.join(scriptsDir, 'cleanup-disk.sh'),
      '#!/bin/bash\necho "cleaned $1"\n',
    );

    const result = await service.run(buildScript(), ['node-1']);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('cleaned node-1');
    expect(scriptRepoMock.update).toHaveBeenCalled();
  });

  it('reports a failing script without throwing', async () => {
    fs.writeFileSync(
      path.join(scriptsDir, 'cleanup-disk.sh'),
      '#!/bin/bash\nexit 3\n',
    );

    const result = await service.run(buildScript());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('finds the enabled script registered for an issue type', async () => {
    scriptRepoMock.find.mockResolvedValue([buildScript()]);

    const script = await service.findForIssueType('disk_full');

    expect(script?.name).toBe('cleanup-disk');
  });

  it('registers a new script with safe defaults', async () => {
    await service.registerScript({
      name: 'renew-certificate',
      issueType: 'certificate_expiry' as never,
      scriptPath: 'renew-certificate.sh',
    });

    expect(scriptRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedEnvironmentsJson: ['staging'],
        defaultArgsJson: [],
        version: 1,
      }),
    );
  });
});
