import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService malware scanning', () => {
  const file = {
    originalname: 'document.pdf',
    buffer: Buffer.from('document'),
  } as Express.Multer.File;

   function createService(
     scanResult: Promise<unknown>,
     configValues: Record<string, unknown> = { CLAM_SCAN_ENABLED: true },
   ) {
     const clamScanService = { scan: jest.fn(() => scanResult) };
     const auditService = { logEvent: jest.fn().mockResolvedValue(null) };
     const config = {
       get: jest.fn((key: string, defaultValue?: unknown) =>
         key in configValues ? configValues[key] : defaultValue,
       ),
     };
     const service = new DocumentsService(
       {} as any,
       {} as any,
       {} as any,
       {} as any,
       config as any,
       clamScanService as any,
       auditService as any,
       null,
     );
     return { service, clamScanService, auditService, config };
   }

  it('rejects out-of-order chunk uploads with a structured error', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    service.recordChunk('file-123', 0, 3, Buffer.from('first'));

    expect(() =>
      service.recordChunk('file-123', 2, 3, Buffer.from('skip')),
    ).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CHUNK_OUT_OF_ORDER' }) }));
  });

  it('idempotently handles duplicate chunk uploads', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    const first = service.recordChunk('file-123', 0, 3, Buffer.from('first'));
    const duplicate = service.recordChunk('file-123', 0, 3, Buffer.from('duplicate'));

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
  });

  it('returns a resume cursor after interruption', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    service.recordChunk('file-123', 0, 3, Buffer.from('first'));
    service.recordChunk('file-123', 1, 3, Buffer.from('second'));

    expect(service.getUploadCursor('file-123')).toMatchObject({
      fileId: 'file-123',
      nextChunkIndex: 2,
      receivedCount: 2,
      complete: false,
    });
  });

  it('expires incomplete uploads after TTL', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));
    (service as any).uploadChunkSessionTtlMs = 0;
    service.recordChunk('file-123', 0, 2, Buffer.from('first'));

    expect(() => service.getUploadCursor('file-123')).toThrow();
  });

  it('allows clean files and records the scan', async () => {
    const { service, clamScanService, auditService } = createService(
      Promise.resolve({ isClean: true }),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).resolves.toBeUndefined();

    expect(clamScanService.scan).toHaveBeenCalledWith(file.buffer);
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('rejects infected files with 422 and audits the rejection', async () => {
    const { service, auditService } = createService(
      Promise.resolve({ isClean: false, virusName: 'Eicar-Test-Signature' }),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(auditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        statusCode: 422,
        requestDetails: expect.objectContaining({
          virusName: 'Eicar-Test-Signature',
        }),
      }),
    );
  });

  it('fails closed with a structured SCAN_UNAVAILABLE error when ClamAV is down', async () => {
    const { service, auditService } = createService(
      Promise.reject(new Error('ECONNREFUSED')),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    await expect(service.scanBeforeUpload(file, 'user-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 503,
        code: 'SCAN_UNAVAILABLE',
      }),
    });
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the scanner times out', async () => {
    const { service } = createService(
      Promise.reject(new Error('ClamAV scan timed out')),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SCAN_UNAVAILABLE' }),
    });
  });

  it('rejects the upload before any storage work when the scan is unavailable', async () => {
    const { service } = createService(
      Promise.reject(new Error('ECONNREFUSED')),
    );
    const storageService = { upload: jest.fn() };
    jest
      .spyOn(service as any, 'getStorageService')
      .mockResolvedValue(storageService as any);

    await expect(
      service.handleUpload({
        file,
        docType: 'bill_of_lading',
        tradeDealId: 'deal-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SCAN_UNAVAILABLE' }),
    });

    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('skips scanning only when CLAM_SCAN_ENABLED is explicitly false', async () => {
    const { service, clamScanService } = createService(
      Promise.resolve({ isClean: true }),
      { CLAM_SCAN_ENABLED: false },
    );

    await service.scanBeforeUpload(file, 'user-1');

    expect(service.isScanningEnabled()).toBe(false);
    expect(clamScanService.scan).not.toHaveBeenCalled();
  });
});
