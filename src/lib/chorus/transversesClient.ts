import { PisteChorusRoutes } from '@/lib/chorus/pisteRoutes';
import type {
  ChorusConfig,
  ChorusSubmissionReferenceResolutionInput,
  ChorusSubmissionReferenceSnapshot,
  ChorusTransverseBankAccount,
  ChorusTransverseCodeListItem,
  ChorusTransverseOperatingService,
  ChorusTransverseRecipient,
  ChorusTransverseStructure,
  ChorusTransverseVatRate,
} from '@/types/chorus';

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanDigits(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\D/g, '');
  return cleaned || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseRateFromLabel(label: string | undefined): number | undefined {
  const match = label?.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[1].replace(',', '.')) / 100;
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();
  const trimmedBody = rawBody.trim();

  if (!trimmedBody) {
    return undefined;
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(trimmedBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function stringifyResponseBody(body: unknown): string {
  if (body === undefined || body === null) {
    return 'Réponse vide';
  }

  if (typeof body === 'string') {
    return compactText(body).slice(0, 500);
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function buildCproAccountHeader(config: ChorusConfig): string | undefined {
  if (!config.technicalLogin || !config.technicalPassword) {
    return undefined;
  }

  return globalThis.btoa(`${config.technicalLogin}:${config.technicalPassword}`);
}

function normalizeCodeList(
  body: unknown,
  listKey: string,
  codeKey: string,
  labelKey?: string,
): ChorusTransverseCodeListItem[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>)[listKey];
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      code: typeof item[codeKey] === 'string' ? item[codeKey] as string : '',
      label: labelKey && typeof item[labelKey] === 'string' ? item[labelKey] as string : undefined,
    }))
    .filter((item) => Boolean(item.code));
}

function normalizeVatRates(body: unknown): ChorusTransverseVatRate[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>).listeTauxTva;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const label = typeof item.libelleTauxTva === 'string' ? item.libelleTauxTva : undefined;
      const explicitRate = asNumber(item.valeurTauxTva);
      return {
        code: typeof item.codeTauxTva === 'string' ? item.codeTauxTva : '',
        label,
        rate: explicitRate !== undefined
          ? (explicitRate > 1 ? explicitRate / 100 : explicitRate)
          : parseRateFromLabel(label),
      };
    })
    .filter((item) => Boolean(item.code));
}

function normalizeStructures(body: unknown): ChorusTransverseStructure[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>).listeStructures;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      designationStructure: typeof item.designationStructure === 'string' ? item.designationStructure : undefined,
      idStructureCPP: asNumber(item.idStructureCPP),
      identifiant: cleanDigits(typeof item.identifiant === 'string' ? item.identifiant : undefined),
    }));
}

function normalizeBankAccounts(body: unknown): ChorusTransverseBankAccount[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>).listeCoordonneeBancaire;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      idCoordonneeBancaire: asNumber(item.idCoordonneeBancaire),
      nomCoordonneeBancaire: typeof item.nomCoordonneeBancaire === 'string' ? item.nomCoordonneeBancaire : undefined,
    }));
}

function normalizeRecipients(body: unknown): ChorusTransverseRecipient[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>).listeDestinataires;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      adresseCodePostal: typeof item.adresseCodePostal === 'string'
        ? item.adresseCodePostal
        : (typeof item.adresseCodePostal === 'number' ? String(item.adresseCodePostal) : undefined),
      adresseVille: typeof item.adresseVille === 'string' ? item.adresseVille : undefined,
      codeDestinataire: cleanDigits(
        typeof item.codeDestinataire === 'string'
          ? item.codeDestinataire
          : (typeof item.identifiant === 'string' ? item.identifiant : undefined),
      ),
      idStructureCPP: asNumber(item.idStructureCPP),
      nomDestinataire: typeof item.nomDestinataire === 'string' ? item.nomDestinataire : undefined,
      siret: cleanDigits(typeof item.siret === 'string' ? item.siret : undefined),
    }));
}

function normalizeOperatingServices(body: unknown): ChorusTransverseOperatingService[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const values = (body as Record<string, unknown>).listeServices;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      codeServiceExecutant: typeof item.codeServiceExecutant === 'string' ? item.codeServiceExecutant : undefined,
      idServicesCPP: asNumber(item.idServicesCPP),
      nomServiceExecutant: typeof item.nomServiceExecutant === 'string' ? item.nomServiceExecutant : undefined,
    }));
}

function nearlyEqual(left: number, right: number, tolerance = 0.0001): boolean {
  return Math.abs(left - right) <= tolerance;
}

function resolveSupplierStructureId(
  structures: ChorusTransverseStructure[],
  currentSupplierId: number | undefined,
  supplierSiret?: string,
): number | undefined {
  if (currentSupplierId !== undefined && structures.some((item) => item.idStructureCPP === currentSupplierId)) {
    return currentSupplierId;
  }

  const normalizedSupplierSiret = cleanDigits(supplierSiret);
  if (normalizedSupplierSiret) {
    const matchedStructure = structures.find((item) => item.identifiant === normalizedSupplierSiret);
    if (matchedStructure?.idStructureCPP !== undefined) {
      return matchedStructure.idStructureCPP;
    }
  }

  if (structures.length === 1 && structures[0]?.idStructureCPP !== undefined) {
    return structures[0].idStructureCPP;
  }

  return currentSupplierId;
}

export class ChorusTransversesClient {
  private readonly routes: PisteChorusRoutes;
  private accessTokenPromise: Promise<string> | null = null;

  constructor(
    private readonly config: ChorusConfig,
    private readonly fetchImpl: typeof fetch = getDefaultFetchImpl(),
  ) {
    this.routes = new PisteChorusRoutes(config);
  }

  private async performFetch(url: string, init: RequestInit, operationLabel: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur réseau inconnue';
      throw new Error(`${operationLabel} impossible vers ${url}: ${message}.`);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessTokenPromise) {
      return this.accessTokenPromise;
    }

    this.accessTokenPromise = (async () => {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: this.config.scope || 'openid',
      });

      const response = await this.performFetch(this.routes.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }, 'Récupération du token OAuth2');

      if (!response.ok) {
        const body = await parseResponseBody(response);
        throw new Error(`Échec OAuth2 (${response.status}): ${stringifyResponseBody(body)}`);
      }

      const data = await response.json() as { access_token?: string };
      if (!data.access_token) {
        throw new Error('Réponse OAuth2 invalide: access_token absent.');
      }

      return data.access_token;
    })();

    try {
      return await this.accessTokenPromise;
    } catch (error) {
      this.accessTokenPromise = null;
      throw error;
    }
  }

  private async buildApiHeaders(extraHeaders?: HeadersInit): Promise<HeadersInit> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json;charset=utf-8',
    };

    const cproAccount = buildCproAccountHeader(this.config);
    if (cproAccount) {
      headers['cpro-account'] = cproAccount;
    }

    const normalizedExtra = extraHeaders instanceof Headers
      ? Object.fromEntries(extraHeaders.entries())
      : Array.isArray(extraHeaders)
        ? Object.fromEntries(extraHeaders)
        : (extraHeaders ?? {});

    return { ...headers, ...normalizedExtra };
  }

  private async postJson(url: string, body: unknown, operationLabel: string): Promise<unknown> {
    const response = await this.performFetch(url, {
      method: 'POST',
      headers: await this.buildApiHeaders({
        'content-type': 'application/json;charset=utf-8',
      }),
      body: JSON.stringify(body),
    }, operationLabel);

    const parsedBody = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`${operationLabel} échoué (${response.status}): ${stringifyResponseBody(parsedBody)}`);
    }

    return parsedBody;
  }

  async fetchCadresFacturation(typeDemandePaiement: string): Promise<ChorusTransverseCodeListItem[]> {
    const body = await this.postJson(
      this.routes.transversesCadresFacturationUrl(),
      { typeDemandePaiement },
      'Récupération des cadres de facturation',
    );

    return normalizeCodeList(body, 'listeCadreFacturation', 'codeCadreFacturation');
  }

  async fetchDevises(codeLangue: 'FR' | 'EN' = 'FR'): Promise<ChorusTransverseCodeListItem[]> {
    const body = await this.postJson(
      this.routes.transversesDevisesUrl(),
      { codeLangue },
      'Récupération des devises',
    );

    return normalizeCodeList(body, 'listeDevises', 'codeDevise', 'libelleDevise');
  }

  async fetchTauxTva(codeLangue: 'FR' | 'EN' = 'FR'): Promise<ChorusTransverseVatRate[]> {
    const body = await this.postJson(
      this.routes.transversesTauxTvaUrl(),
      { codeLangue },
      'Récupération des taux TVA',
    );

    return normalizeVatRates(body);
  }

  async fetchModesReglement(): Promise<ChorusTransverseCodeListItem[]> {
    const body = await this.postJson(
      this.routes.transversesModesReglementUrl(),
      {},
      'Récupération des modes de règlement',
    );

    return normalizeCodeList(body, 'listeModePaiement', 'modePaiement');
  }

  async fetchModesDepot(): Promise<ChorusTransverseCodeListItem[]> {
    const body = await this.postJson(
      this.routes.transversesModesDepotUrl(),
      {},
      'Récupération des modes de dépôt',
    );

    return normalizeCodeList(body, 'listeModeDepot', 'modeDepot');
  }

  async fetchStructuresActivesFournisseur(): Promise<ChorusTransverseStructure[]> {
    const body = await this.postJson(
      this.routes.transversesStructuresActivesFournisseurUrl(),
      {},
      'Récupération des structures actives fournisseur',
    );

    return normalizeStructures(body);
  }

  async fetchCoordonneesBancairesValides(idStructure: number): Promise<ChorusTransverseBankAccount[]> {
    const body = await this.postJson(
      this.routes.transversesCoordonneesBancairesValidesUrl(),
      { idStructure },
      'Récupération des coordonnées bancaires valides',
    );

    return normalizeBankAccounts(body);
  }

  async searchDestinataires(identifiant?: string): Promise<ChorusTransverseRecipient[]> {
    if (!identifiant) {
      return [];
    }

    const body = await this.postJson(
      this.routes.transversesRechercherDestinataireUrl(),
      {
        identifiant,
        nomVilleCodePostal: null,
        typeStructure: 'PUBLIQUE',
        parametresRecherche: {
          pageResultatDemandee: 1,
          nbResultatsParPage: 10,
          triSens: 'Ascendant',
          triColonne: 'NomDestinataire',
        },
      },
      'Recherche du destinataire',
    );

    return normalizeRecipients(body);
  }

  async searchServicesExecutants(
    idDestinataireCPP: number,
    codeServiceExecutant?: string,
  ): Promise<ChorusTransverseOperatingService[]> {
    const body = await this.postJson(
      this.routes.transversesRechercherServiceExecutantUrl(),
      {
        idDestinataireCPP,
        codeServiceExecutant: codeServiceExecutant || null,
        nomServiceExecutant: null,
        actif: true,
        parametresRecherche: {
          pageResultatDemandee: 1,
          nbResultatsParPage: 20,
          triSens: 'Descendant',
          triColonne: 'NomServiceExecutant',
        },
      },
      'Recherche du service exécutant',
    );

    return normalizeOperatingServices(body);
  }

  async resolveSubmissionReferences(
    input: ChorusSubmissionReferenceResolutionInput,
  ): Promise<ChorusSubmissionReferenceSnapshot> {
    const payload = input.payload;
    const codeLangue = input.codeLangue ?? 'FR';

    const [
      cadresFacturation,
      devises,
      tauxTva,
      modesReglement,
      modesDepot,
      structuresFournisseur,
    ] = await Promise.all([
      this.fetchCadresFacturation(payload.references.typeFacture),
      this.fetchDevises(codeLangue),
      this.fetchTauxTva(codeLangue),
      this.fetchModesReglement(),
      this.fetchModesDepot(),
      this.fetchStructuresActivesFournisseur(),
    ]);

    const resolvedSupplierStructureId = resolveSupplierStructureId(
      structuresFournisseur,
      payload.fournisseur.idFournisseur,
      input.supplierSiret,
    );

    const coordonneesBancaires = resolvedSupplierStructureId !== undefined
      ? await this.fetchCoordonneesBancairesValides(resolvedSupplierStructureId)
      : [];

    const recipientLookup = cleanDigits(payload.destinataire.codeDestinataire)
      || cleanDigits(input.recipientCode)
      || cleanDigits(input.recipientSiret);
    const destinataires = await this.searchDestinataires(recipientLookup);
    const normalizedRecipientCode = cleanDigits(payload.destinataire.codeDestinataire);
    const matchedDestinataire = normalizedRecipientCode
      ? destinataires.find((item) => item.codeDestinataire === normalizedRecipientCode || item.siret === normalizedRecipientCode)
      : undefined;

    const servicesExecutants = matchedDestinataire?.idStructureCPP !== undefined
      ? await this.searchServicesExecutants(matchedDestinataire.idStructureCPP, payload.destinataire.codeServiceExecutant)
      : [];

    const warnings: string[] = [];

    const cadreFacturationValid = cadresFacturation.some((item) => item.code === payload.cadreDeFacturation.codeCadreFacturation);
    if (!cadreFacturationValid) {
      warnings.push('Le codeCadreFacturation courant n’apparaît pas dans le référentiel Transverses.');
    }

    const deviseValid = devises.some((item) => item.code === payload.references.deviseFacture);
    if (!deviseValid) {
      warnings.push('La devise du payload n’apparaît pas dans le référentiel Transverses.');
    }

    const modePaiementValid = modesReglement.some((item) => item.code === payload.references.modePaiement);
    if (!modePaiementValid) {
      warnings.push('Le mode de paiement du payload n’apparaît pas dans le référentiel Transverses.');
    }

    const modeDepotValid = modesDepot.some((item) => item.code === payload.modeDepot);
    if (!modeDepotValid) {
      warnings.push('Le mode de dépôt du payload n’apparaît pas dans le référentiel Transverses.');
    }

    const fournisseurStructureValid = resolvedSupplierStructureId !== undefined
      ? structuresFournisseur.some((item) => item.idStructureCPP === resolvedSupplierStructureId)
      : payload.fournisseur.idFournisseur === undefined;
    if (resolvedSupplierStructureId !== undefined && !fournisseurStructureValid) {
      warnings.push('L’idFournisseur courant n’apparaît pas dans les structures actives fournisseur.');
    }

    const coordonneeBancaireValide = payload.fournisseur.codeCoordonneesBancairesFournisseur === undefined
      ? true
      : coordonneesBancaires.some((item) => item.idCoordonneeBancaire === payload.fournisseur.codeCoordonneesBancairesFournisseur);
    if (payload.fournisseur.codeCoordonneesBancairesFournisseur !== undefined && !coordonneeBancaireValide) {
      warnings.push('Le codeCoordonneesBancairesFournisseur courant n’apparaît pas dans les coordonnées bancaires valides.');
    }

    const destinataireTrouve = matchedDestinataire !== undefined;
    if (payload.destinataire.codeDestinataire && !destinataireTrouve) {
      warnings.push('Aucun destinataire Chorus n’a été retrouvé pour le code destinataire / SIRET saisi.');
    }

    const serviceExecutantTrouve = payload.destinataire.codeServiceExecutant
      ? servicesExecutants.some((item) => item.codeServiceExecutant === payload.destinataire.codeServiceExecutant)
      : true;
    if (payload.destinataire.codeServiceExecutant && !serviceExecutantTrouve) {
      warnings.push('Aucun service exécutant Chorus n’a été retrouvé pour ce destinataire.');
    }

    const payloadRates = payload.ligneTva
      .map((item) => {
        if (!item.ligneTvaTaux) {
          return undefined;
        }

        const matchingCode = tauxTva.find((rate) => rate.code === item.ligneTvaTaux);
        if (matchingCode?.rate !== undefined) {
          return matchingCode.rate;
        }

        const parsed = Number(item.ligneTvaTaux);
        return Number.isFinite(parsed) ? parsed : undefined;
      })
      .filter((value): value is number => value !== undefined);

    const tauxTvaValides = payloadRates.length === 0
      ? true
      : payloadRates.every((rate) => tauxTva.some((item) => item.rate !== undefined && nearlyEqual(item.rate, rate)));
    if (!tauxTvaValides) {
      warnings.push('Au moins un taux TVA du payload n’apparaît pas dans le référentiel Transverses.');
    }

    return {
      cadresFacturation,
      devises,
      tauxTva,
      modesReglement,
      modesDepot,
      coordonneesBancaires,
      structuresFournisseur,
      destinataires,
      servicesExecutants,
      checks: {
        cadreFacturationValid,
        deviseValid,
        modePaiementValid,
        modeDepotValid,
        fournisseurStructureValid,
        coordonneeBancaireValide,
        destinataireTrouve,
        serviceExecutantTrouve,
        tauxTvaValides,
        warnings,
      },
    };
  }
}
