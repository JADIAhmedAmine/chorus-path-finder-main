import { attachMainFileToChorusSubmissionPayload } from '@/lib/chorus/buildSubmissionPayload';
import { CHORUS_OAUTH_TOKEN_PATH, resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import { PisteChorusRoutes } from '@/lib/chorus/pisteRoutes';
import type { ChorusConfig } from '@/types/chorus';
import type { ChorusSubmissionPayload, ChorusSubmissionValidationResult } from '@/lib/chorus/types';

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function escapeSingleQuotedShell(value: string): string {
  return value.replace(/'/g, `'\"'\"'`);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

function buildSubmitDebugPayload(
  payload: ChorusSubmissionPayload,
  routes: PisteChorusRoutes,
  mainFileName?: string,
): unknown {
  const { idUtilisateurCourant: _ignoredCurrentUserId, ...payloadWithoutCurrentUserId } = payload;

  if (routes.isAttachmentUpload()) {
    return attachMainFileToChorusSubmissionPayload(payloadWithoutCurrentUserId, {
      mainFileId: '<PIECE_JOINTE_ID_FROM_UPLOAD>',
      mainFileName,
      modeDepot: 'SAISIE_API',
    });
  }

  if (!routes.isPdfDepositUpload()) {
    return payloadWithoutCurrentUserId;
  }

  return {
    ...payloadWithoutCurrentUserId,
    modeDepot: 'DEPOT_PDF_SIGNE_API',
    pieceJointePrincipale: [{
      pieceJointePrincipaleDesignation: mainFileName?.startsWith('GCU_') ? mainFileName : 'GCU_MSG_01_000',
      pieceJointePrincipaleId: '<PIECE_JOINTE_ID_FROM_UPLOAD>',
    }],
  };
}

function buildCurlCommand(
  url: string,
  headers: Record<string, string | undefined>,
  body: string,
): string {
  const headerLines = Object.entries(headers)
    .filter(([, value]) => value)
    .map(([key, value]) => `  --header '${key}: ${escapeSingleQuotedShell(String(value))}' \\`)
    .join('\n');

  return [
    `curl --request POST \\`,
    `  --url '${escapeSingleQuotedShell(url)}' \\`,
    headerLines,
    `  --data-raw '${escapeSingleQuotedShell(body)}'`,
  ].filter(Boolean).join('\n');
}

export async function buildChorusDebugFile(input: {
  config: ChorusConfig;
  payload: ChorusSubmissionPayload;
  validation: ChorusSubmissionValidationResult;
  mainFile?: File | null;
  connectionTestMethod?: 'GET' | 'POST';
}): Promise<string> {
  const routes = new PisteChorusRoutes(input.config);
  const lines: string[] = [];

  lines.push('# debug_chorus');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Validation locale');
  lines.push(compactJson(input.validation));
  lines.push('');

  lines.push('## 1. OAuth2 token via API serveur');
  lines.push(buildCurlCommand(resolveChorusBridgeUrl(input.config, CHORUS_OAUTH_TOKEN_PATH), {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json',
  }, compactJson({ environment: input.config.environment })));
  lines.push('');

  if (input.connectionTestMethod === 'POST' && routes.connectionTestPath) {
    lines.push('## 2. Test de connexion Chorus');
    lines.push(buildCurlCommand(routes.connectionTestUrl(), {
      Authorization: 'Bearer <ACCESS_TOKEN_FROM_OAUTH2>',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }, compactJson({})));
    lines.push('');
  }

  if (input.mainFile && routes.uploadFilePath) {
    lines.push('## 3. Upload de la facture principale');

    if (routes.isAttachmentUpload() || routes.isPdfDepositUpload()) {
      const uploadPayload = {
        pieceJointeExtension: 'pdf',
        pieceJointeFichier: await fileToBase64(input.mainFile),
        pieceJointeNom: input.mainFile.name,
        pieceJointeTypeMime: input.mainFile.type || 'application/pdf',
      };

      lines.push(buildCurlCommand(routes.uploadFileUrl(), {
        Authorization: 'Bearer <ACCESS_TOKEN_FROM_OAUTH2>',
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      }, compactJson(uploadPayload)));
    } else {
      lines.push([
        'curl --request POST \\',
        `  --url '${escapeSingleQuotedShell(routes.uploadFileUrl())}' \\`,
        `  --header 'Authorization: Bearer <ACCESS_TOKEN_FROM_OAUTH2>' \\`,
        `  --form 'file=@${escapeSingleQuotedShell(input.mainFile.name)}'`,
      ].filter(Boolean).join('\n'));
    }

    lines.push('');
  }

  lines.push('## 4. Soumission de facture');
  lines.push(buildCurlCommand(routes.submitInvoiceUrl(), {
    Authorization: 'Bearer <ACCESS_TOKEN_FROM_OAUTH2>',
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json',
  }, compactJson(buildSubmitDebugPayload(input.payload, routes, input.mainFile?.name))));
  lines.push('');

  lines.push('## Payload final');
  lines.push(compactJson(buildSubmitDebugPayload(input.payload, routes, input.mainFile?.name)));
  lines.push('');

  return lines.join('\n');
}
