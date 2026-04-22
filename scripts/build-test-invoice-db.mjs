import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ANNUAIRE_JSON_PATH = path.join(ROOT_DIR, 'public', 'annuaire', 'annuaire.normalized.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'test-data');
const SAMPLE_PDF_PUBLIC_PATH = '/test-data/facture_prototype_chorus_test.pdf';
const INVOICE_COUNT = 12;
const TENANT_ID = 'tenant-gigalis-test';
const USER_ID = 'user-marie-dupont';
const SUPPLIER_ID = '26359578';
const SUPPLIER_SIRET = '32242033407300';
const SUPPLIER_NAME = 'Destinataire 32242033407300';

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function formatIso(date) {
  return new Date(date).toISOString();
}

function leadingDigits(value) {
  const match = value.match(/^(\d{6,})/);
  return match?.[1] ?? '';
}

function serviceScore(service, token) {
  const code = String(service.codeServiceExecutant || '');
  const label = String(service.label || '');
  let score = 0;

  if (service.active) score += 100;
  if (code.startsWith('SERVICE_DESTINATAIRE')) score += 40;
  if (label.startsWith('SERVICE_DESTINATAIRE')) score += 20;
  if (code.includes(token)) score += 30;
  if (label.includes(token)) score += 10;

  return score;
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildStatusScenario(index) {
  const scenarios = [
    { status: 'DRAFT_STRUCTURED', chorusStatus: undefined },
    { status: 'READY_FOR_SUBMISSION', chorusStatus: undefined },
    { status: 'SUBMITTED_TO_CHORUS', chorusStatus: 'DEPOSEE' },
    { status: 'ACCEPTED_BY_CHORUS', chorusStatus: 'MISE_A_DISPOSITION' },
    { status: 'PAID', chorusStatus: 'MISE_EN_PAIEMENT' },
    { status: 'PENDING_HUMAN_REVIEW', chorusStatus: undefined, requiresReview: true },
    {
      status: 'REJECTED_BUSINESS',
      chorusStatus: 'REJETEE',
      reasonCode: 'REJET_METIER',
      reasonLabel: 'Le service destinataire demande une correction avant poursuite.',
    },
  ];

  return scenarios[index % scenarios.length];
}

function buildHistoryEntries(invoice, scenario, createdAt) {
  const entries = [
    {
      previousStatus: undefined,
      newStatus: 'DRAFT_UPLOADED',
      eventCode: 'UPLOAD_RECEIVED',
      eventLabel: 'Facture chargee',
      source: 'USER',
      occurredAt: createdAt,
    },
    {
      previousStatus: 'DRAFT_UPLOADED',
      newStatus: 'DRAFT_STRUCTURED',
      eventCode: 'EXTRACTION_DONE',
      eventLabel: 'Extraction locale terminee',
      source: 'SYSTEM',
      occurredAt: new Date(new Date(createdAt).getTime() + 10 * 60 * 1000).toISOString(),
    },
  ];

  if (scenario.status === 'PENDING_HUMAN_REVIEW') {
    entries.push({
      previousStatus: 'DRAFT_STRUCTURED',
      newStatus: 'PENDING_HUMAN_REVIEW',
      eventCode: 'REVIEW_REQUIRED',
      eventLabel: 'Controle humain demande',
      source: 'SYSTEM',
      occurredAt: new Date(new Date(createdAt).getTime() + 30 * 60 * 1000).toISOString(),
    });
    return entries;
  }

  if (scenario.status === 'READY_FOR_SUBMISSION') {
    entries.push({
      previousStatus: 'DRAFT_STRUCTURED',
      newStatus: 'READY_FOR_SUBMISSION',
      eventCode: 'PAYLOAD_READY',
      eventLabel: 'Payload Chorus pret',
      source: 'SYSTEM',
      occurredAt: new Date(new Date(createdAt).getTime() + 30 * 60 * 1000).toISOString(),
    });
    return entries;
  }

  if (['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(scenario.status)) {
    entries.push(
      {
        previousStatus: 'DRAFT_STRUCTURED',
        newStatus: 'SUBMISSION_REQUESTED',
        eventCode: 'SUBMISSION_REQUESTED',
        eventLabel: 'Soumission demandee',
        source: 'USER',
        occurredAt: new Date(new Date(createdAt).getTime() + 45 * 60 * 1000).toISOString(),
      },
      {
        previousStatus: 'SUBMISSION_REQUESTED',
        newStatus: 'SUBMITTED_TO_CHORUS',
        eventCode: 'SUBMITTED_TO_CHORUS',
        eventLabel: 'Facture transmise a Chorus',
        source: 'CHORUS',
        occurredAt: new Date(new Date(createdAt).getTime() + 60 * 60 * 1000).toISOString(),
      },
    );
  }

  if (scenario.status === 'ACCEPTED_BY_CHORUS' || scenario.status === 'PAID') {
    entries.push({
      previousStatus: 'SUBMITTED_TO_CHORUS',
      newStatus: 'ACCEPTED_BY_CHORUS',
      eventCode: 'CHORUS_ACCEPTED',
      eventLabel: 'Facture acceptee par Chorus',
      source: 'CHORUS',
      occurredAt: new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (scenario.status === 'PAID') {
    entries.push({
      previousStatus: 'ACCEPTED_BY_CHORUS',
      newStatus: 'PAID',
      eventCode: 'CHORUS_PAID',
      eventLabel: 'Facture payee',
      source: 'CHORUS',
      occurredAt: new Date(new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (scenario.status === 'REJECTED_BUSINESS') {
    entries.push({
      previousStatus: 'SUBMITTED_TO_CHORUS',
      newStatus: 'REJECTED_BUSINESS',
      eventCode: 'CHORUS_REJECTED',
      eventLabel: 'Facture rejetee',
      source: 'CHORUS',
      occurredAt: new Date(new Date(createdAt).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return entries;
}

function buildApiLogs(invoice, scenario, createdAt, attachment) {
  if (!['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(scenario.status)) {
    return [];
  }

  const submitCorrelationId = `corr-submit-${invoice.id}`;
  const uploadCorrelationId = `corr-upload-${invoice.id}`;
  const uploadTime = new Date(new Date(createdAt).getTime() + 45 * 60 * 1000).toISOString();
  const submitTime = new Date(new Date(createdAt).getTime() + 60 * 60 * 1000).toISOString();

  return [
    {
      id: `api-upload-${invoice.id}`,
      tenantId: TENANT_ID,
      invoiceId: invoice.id,
      targetSystem: 'CHORUS_PRO',
      operationName: 'ajouter/fichier',
      correlationId: uploadCorrelationId,
      direction: 'OUTBOUND',
      httpStatus: 200,
      businessCode: 'TRA_MSG_00.000',
      businessMessage: 'Piece jointe ajoutee',
      requestHeadersRedacted: JSON.stringify({ Accept: 'application/json' }),
      requestBodyRedacted: JSON.stringify({
        nomFichier: attachment.filename,
        formatDepot: 'APPLICATION_PDF',
      }),
      responseHeadersRedacted: JSON.stringify({ 'content-type': 'application/json' }),
      responseBodyRedacted: JSON.stringify({ pieceJointeId: attachment.chorusFileId }),
      latencyMs: 480,
      success: true,
      createdAt: uploadTime,
    },
    {
      id: `api-submit-${invoice.id}`,
      tenantId: TENANT_ID,
      invoiceId: invoice.id,
      targetSystem: 'CHORUS_PRO',
      operationName: 'soumettreFacture',
      correlationId: submitCorrelationId,
      direction: 'OUTBOUND',
      httpStatus: scenario.status === 'REJECTED_BUSINESS' ? 202 : 200,
      businessCode: scenario.status === 'REJECTED_BUSINESS' ? 'GCU_MSG_01_000' : 'TRA_MSG_00.000',
      businessMessage: scenario.status === 'REJECTED_BUSINESS' ? 'Facture acceptee puis rejetee metierement' : 'Facture soumise',
      requestHeadersRedacted: JSON.stringify({ Accept: 'application/json' }),
      requestBodyRedacted: JSON.stringify({
        numeroFactureSaisi: invoice.supplierInvoiceNumber,
        codeDestinataire: invoice.publicCustomerId,
        montantTtcTotal: invoice.totalTtc,
      }),
      responseHeadersRedacted: JSON.stringify({ 'content-type': 'application/json' }),
      responseBodyRedacted: JSON.stringify({
        numeroFactureChorus: invoice.chorusInvoiceNumber ?? null,
        statut: scenario.status,
      }),
      latencyMs: 910,
      success: true,
      createdAt: submitTime,
    },
  ];
}

function buildAsyncJobs(invoices) {
  return invoices.slice(0, 6).map((invoice, index) => ({
    id: `job-${invoice.id}`,
    tenantId: TENANT_ID,
    invoiceId: invoice.id,
    jobType: index % 2 === 0 ? 'CHORUS_STATUS_SYNC' : 'SUBMISSION_RETRY_GUARD',
    status: index % 3 === 0 ? 'DONE' : index % 3 === 1 ? 'RUNNING' : 'PENDING',
    attemptCount: index % 3,
    maxAttempts: 5,
    nextAttemptAt: index % 3 === 2 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    payload: {
      invoiceId: invoice.id,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
    },
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  }));
}

function buildAuditLogs(invoices) {
  return invoices.flatMap((invoice) => [
    {
      id: `audit-create-${invoice.id}`,
      tenantId: TENANT_ID,
      actorType: 'USER',
      actorId: USER_ID,
      actionCode: 'INVOICE_CREATED',
      entityType: 'INVOICE',
      entityId: invoice.id,
      diff: {
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        statusInternal: invoice.statusInternal,
      },
      ipAddress: '127.0.0.1',
      userAgent: 'FacturX Pro Test Data Generator',
      createdAt: invoice.createdAt,
    },
    {
      id: `audit-update-${invoice.id}`,
      tenantId: TENANT_ID,
      actorType: 'SYSTEM',
      actorId: 'chorus-sync',
      actionCode: 'INVOICE_STATUS_SYNCED',
      entityType: 'INVOICE',
      entityId: invoice.id,
      diff: {
        statusInternal: invoice.statusInternal,
        statusChorus: invoice.statusChorus ?? null,
      },
      ipAddress: undefined,
      userAgent: 'FacturX Pro Test Data Generator',
      createdAt: invoice.updatedAt,
    },
  ]);
}

function buildExtractionResults(invoices, customersById, servicesById) {
  return invoices.map((invoice, index) => {
    const customer = customersById.get(invoice.publicCustomerId);
    const service = invoice.publicServiceId ? servicesById.get(invoice.publicServiceId) : undefined;
    return {
      id: `extract-${invoice.id}`,
      tenantId: TENANT_ID,
      invoiceId: invoice.id,
      engineName: 'annuaire-test-builder',
      engineVersion: '1.0.0',
      rawText: `${SUPPLIER_NAME}\n${customer?.legalName ?? ''}\n${invoice.supplierInvoiceNumber}`,
      extractedPayload: {
        supplierName: SUPPLIER_NAME,
        supplierSiret: SUPPLIER_SIRET,
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        invoiceDate: invoice.invoiceDate,
        publicCustomerName: customer?.legalName ?? '',
        publicCustomerSiret: customer?.siret ?? '',
        publicServiceCode: service?.codeServiceExecutant ?? '',
        publicServiceLabel: service?.label ?? '',
        totalAmountHt: invoice.totalHt,
        totalVat: invoice.totalVat,
        totalAmountTtc: invoice.totalTtc,
      },
      confidenceScore: roundCurrency(0.86 + ((index % 4) * 0.03)),
      requiresReview: invoice.requiresHumanReview,
      createdAt: invoice.createdAt,
    };
  });
}

async function writeJson(fileName, payload) {
  await writeFile(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const annuaire = JSON.parse(await readFile(ANNUAIRE_JSON_PATH, 'utf8'));
  const annuaireCustomers = Array.isArray(annuaire.publicCustomers) ? annuaire.publicCustomers : [];
  const annuaireServices = Array.isArray(annuaire.publicServices) ? annuaire.publicServices : [];
  const servicesByCustomerId = new Map();

  for (const service of annuaireServices) {
    const customerServices = servicesByCustomerId.get(service.publicCustomerId) ?? [];
    customerServices.push(service);
    servicesByCustomerId.set(service.publicCustomerId, customerServices);
  }

  const matchedPairs = annuaireCustomers
    .filter((customer) => customer.active !== false)
    .map((customer) => {
      const token = leadingDigits(String(customer.legalName || ''));
      if (!token) {
        return null;
      }

      const services = servicesByCustomerId.get(customer.id) ?? [];
      const matchingServices = services
        .filter((service) => {
          const code = String(service.codeServiceExecutant || '');
          const label = String(service.label || '');
          return code.includes(token) || label.includes(token);
        })
        .sort((left, right) => serviceScore(right, token) - serviceScore(left, token));

      if (matchingServices.length === 0) {
        return null;
      }

      return {
        customer,
        service: matchingServices[0],
        token,
      };
    })
    .filter(Boolean)
    .slice(0, INVOICE_COUNT);

  if (matchedPairs.length < INVOICE_COUNT) {
    throw new Error(`Impossible de trouver ${INVOICE_COUNT} couples client/service dans l'annuaire.`);
  }

  const baseCreatedAt = new Date(Date.UTC(2025, 5, 3, 8, 0, 0));
  const tenant = {
    id: TENANT_ID,
    code: 'GIGALIS-TEST',
    name: 'Gigalis - Base de test factures',
    active: true,
    createdAt: formatIso(baseCreatedAt),
    updatedAt: formatIso(baseCreatedAt),
  };
  const currentUser = {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: 'marie.dupont@acme-solutions.fr',
    firstName: 'Marie',
    lastName: 'Dupont',
    roleCode: 'GESTIONNAIRE',
    active: true,
    createdAt: formatIso(baseCreatedAt),
    updatedAt: formatIso(baseCreatedAt),
  };
  const suppliers = [
    {
      id: SUPPLIER_ID,
      tenantId: TENANT_ID,
      legalName: SUPPLIER_NAME,
      siret: SUPPLIER_SIRET,
      vatNumber: '',
      chorusSupplierCode: SUPPLIER_ID,
      active: true,
      createdAt: formatIso(baseCreatedAt),
      updatedAt: formatIso(baseCreatedAt),
    },
  ];

  const publicCustomers = matchedPairs.map(({ customer }) => ({
    ...customer,
    tenantId: TENANT_ID,
  }));
  const publicServices = matchedPairs.map(({ service }) => ({
    ...service,
    tenantId: TENANT_ID,
  }));
  const customerById = new Map(publicCustomers.map((customer) => [customer.id, customer]));
  const serviceById = new Map(publicServices.map((service) => [service.id, service]));

  const invoices = matchedPairs.map(({ customer, service, token }, index) => {
    const invoiceNumber = `2025-006-${String(1012 + index).padStart(5, '0')}`;
    const invoiceDate = new Date(Date.UTC(2025, 5, 3 + index, 0, 0, 0));
    const dueDate = new Date(Date.UTC(2025, 6, 3 + index, 0, 0, 0));
    const createdAt = new Date(baseCreatedAt.getTime() + index * 2 * 60 * 60 * 1000);
    const scenario = buildStatusScenario(index);
    const totalHt = roundCurrency(680 + index * 79.5 + (index % 2 === 0 ? 47.25 : 0));
    const totalVat = roundCurrency(totalHt * 0.2);
    const totalTtc = roundCurrency(totalHt + totalVat);

    return {
      id: `invoice-test-${String(index + 1).padStart(4, '0')}`,
      tenantId: TENANT_ID,
      supplierOrganizationId: SUPPLIER_ID,
      sourceFormat: 'PDF',
      supplierInvoiceNumber: invoiceNumber,
      chorusInvoiceNumber: ['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(scenario.status)
        ? `202600000000000000${String(index + 19).padStart(3, '0')}`
        : undefined,
      invoiceDate: invoiceDate.toISOString().slice(0, 10),
      dueDate: dueDate.toISOString().slice(0, 10),
      currencyCode: 'EUR',
      totalHt,
      totalVat,
      totalTtc,
      publicCustomerId: customer.id,
      publicServiceId: service.id,
      engagementNumber: index % 2 === 0 ? `BC2025/25-${String(index + 700).padStart(6, '0')}` : undefined,
      purchaseOrderNumber: index % 3 === 0 ? `CMD-${token}-${String(index + 1).padStart(3, '0')}` : undefined,
      marketNumber: index % 4 === 0 ? `MA-${token}-${String(index + 1).padStart(2, '0')}` : undefined,
      depositMode: 'API',
      statusInternal: scenario.status,
      statusChorus: scenario.chorusStatus,
      statusReasonCode: scenario.reasonCode,
      statusReasonLabel: scenario.reasonLabel,
      extractionConfidence: roundCurrency(0.84 + ((index % 4) * 0.03)),
      requiresHumanReview: !!scenario.requiresReview,
      currentRevision: 1,
      submittedAt: ['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(scenario.status)
        ? new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString()
        : undefined,
      lastStatusSyncAt: ['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(scenario.status)
        ? new Date(createdAt.getTime() + 3 * 60 * 60 * 1000).toISOString()
        : undefined,
      createdBy: USER_ID,
      updatedBy: USER_ID,
      createdAt: createdAt.toISOString(),
      updatedAt: new Date(createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    };
  });

  const invoiceLines = invoices.map((invoice, index) => ({
    id: `line-${invoice.id}`,
    tenantId: TENANT_ID,
    invoiceId: invoice.id,
    lineNumber: 1,
    description: `Prestation Chorus test ${index + 1}`,
    quantity: 1,
    unitCode: 'UNITE',
    unitPriceHt: invoice.totalHt,
    vatRate: 20,
    lineTotalHt: invoice.totalHt,
    lineTotalTtc: invoice.totalTtc,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  }));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const repairedInvoiceLines = invoiceLines.map((line) => {
    const invoice = invoicesById.get(line.invoiceId);
    if (!invoice) {
      return line;
    }

    return {
      ...line,
      unitPriceHt: invoice.totalHt,
      lineTotalHt: invoice.totalHt,
      lineTotalTtc: invoice.totalTtc,
      vatRate: 20,
    };
  });

  const invoiceAttachments = invoices.map((invoice) => ({
      id: `attachment-${invoice.id}`,
      tenantId: TENANT_ID,
      invoiceId: invoice.id,
    attachmentRole: 'MAIN',
      attachmentTypeCode: 'FACTURE',
      filename: `${invoice.supplierInvoiceNumber}.pdf`,
      mimeType: 'application/pdf',
      storageKey: SAMPLE_PDF_PUBLIC_PATH,
    sha256: hashValue(invoice.id),
    sizeBytes: 104857 + invoice.supplierInvoiceNumber.length * 128,
    chorusFileId: ['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(invoice.statusInternal)
      ? String(10846000 + Number(invoice.id.slice(-4)))
      : undefined,
    uploadedToChorus: ['SUBMITTED_TO_CHORUS', 'ACCEPTED_BY_CHORUS', 'PAID', 'REJECTED_BUSINESS'].includes(invoice.statusInternal),
    createdAt: invoice.createdAt,
  }));

  const statusHistory = invoices.flatMap((invoice) =>
    buildHistoryEntries(invoice, buildStatusScenario(Number(invoice.id.slice(-4)) - 1), invoice.createdAt).map((entry, index) => ({
      id: `history-${invoice.id}-${index + 1}`,
      tenantId: TENANT_ID,
      invoiceId: invoice.id,
      source: entry.source,
      previousStatus: entry.previousStatus,
      newStatus: entry.newStatus,
      eventCode: entry.eventCode,
      eventLabel: entry.eventLabel,
      rawSnapshot: {
        invoiceId: invoice.id,
        status: entry.newStatus,
      },
      occurredAt: entry.occurredAt,
    })),
  );

  const attachmentsByInvoiceId = new Map(invoiceAttachments.map((attachment) => [attachment.invoiceId, attachment]));
  const apiExchangeLogs = invoices.flatMap((invoice) =>
    buildApiLogs(
      invoice,
      buildStatusScenario(Number(invoice.id.slice(-4)) - 1),
      invoice.createdAt,
      attachmentsByInvoiceId.get(invoice.id),
    ),
  );

  const asyncJobs = buildAsyncJobs(invoices);
  const auditLogs = buildAuditLogs(invoices);
  const extractionResults = buildExtractionResults(invoices, customerById, serviceById);

  const database = {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceAnnuaire: '/annuaire/annuaire.normalized.json',
      matchingRule: 'prefixe numerique du nom client -> service contenant ce prefixe, priorite SERVICE_DESTINATAIRE',
      invoiceCount: invoices.length,
      customerCount: publicCustomers.length,
      serviceCount: publicServices.length,
    },
    tenant,
    currentUser,
    suppliers,
    publicCustomers,
    publicServices,
    invoices,
    invoiceLines: repairedInvoiceLines,
    invoiceAttachments,
    statusHistory,
    apiExchangeLogs,
    asyncJobs,
    auditLogs,
    extractionResults,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeJson('invoice-database.json', database),
    writeJson('tenant.current.json', { tenant }),
    writeJson('users.me.json', { user: currentUser }),
    writeJson('suppliers.json', { suppliers }),
    writeJson('public-customers.json', { publicCustomers }),
    writeJson('public-services.json', { publicServices }),
    writeJson('invoices.json', { invoices }),
    writeJson('invoice-lines.json', { invoiceLines: repairedInvoiceLines }),
    writeJson('invoice-attachments.json', { invoiceAttachments }),
    writeJson('invoice-status-history.json', { statusHistory }),
    writeJson('api-exchange-logs.json', { apiExchangeLogs }),
    writeJson('async-jobs.json', { asyncJobs }),
    writeJson('audit-logs.json', { auditLogs }),
    writeJson('invoice-extraction-results.json', { extractionResults }),
  ]);

  console.log(
    `Base de test facture generee dans ${path.relative(ROOT_DIR, OUTPUT_DIR)}: `
      + `${invoices.length} factures, ${publicCustomers.length} clients, ${publicServices.length} services.`,
  );
}

await main();
