import {
  assertCrashBundlePrivacySafe,
  type CrashBundle,
} from './crashBundle';

export interface CrashBundleExportFile {
  fileName: string;
  mimeType: 'application/json';
  contents: string;
  byteLength: number;
}

export interface CrashBundleExporter {
  save(file: CrashBundleExportFile): void | Promise<void>;
}

function fileTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, '-');
}

export function createCrashBundleExportFile(bundle: CrashBundle): CrashBundleExportFile {
  assertCrashBundlePrivacySafe(bundle);
  const contents = `${JSON.stringify(bundle, null, 2)}\n`;
  return {
    fileName: `gravity-well-crash-${fileTimestamp(bundle.capturedAt)}.json`,
    mimeType: 'application/json',
    contents,
    byteLength: new TextEncoder().encode(contents).byteLength,
  };
}

export async function exportCrashBundle(
  bundle: CrashBundle,
  exporter: CrashBundleExporter,
): Promise<CrashBundleExportFile> {
  const file = createCrashBundleExportFile(bundle);
  await exporter.save(file);
  return file;
}

export function createBrowserCrashBundleExporter(): CrashBundleExporter {
  return {
    save(file): void {
      const url = URL.createObjectURL(new Blob([file.contents], { type: file.mimeType }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.fileName;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
}
