import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, ArrowLeft, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Section {
  id: string;
  title: string;
  content: string[];
}

const sections: Section[] = [
  {
    id: 'objet',
    title: '1. Objet du service',
    content: [
      'Chorus Pilot permet de faciliter le traitement, le dépôt, le suivi et l\'analyse de flux de facturation électronique à destination du secteur public via les APIs Chorus Pro / PISTE.',
    ],
  },
  {
    id: 'acces',
    title: '2. Accès au service',
    content: [
      'L\'accès à Chorus Pilot est réservé aux utilisateurs autorisés. Chaque utilisateur est responsable de la confidentialité de ses identifiants et de l\'usage réalisé depuis son compte.',
      'La transmission de vos identifiants à des tiers non autorisés entraînerait une responsabilité de votre part.',
    ],
  },
  {
    id: 'fonctionnalites',
    title: '3. Fonctionnalités principales',
    content: [
      'Chorus Pilot offre les fonctionnalités suivantes :',
      '• Dépôt de flux XML / UBL',
      '• Consultation des formats et syntaxes de flux',
      '• Consultation des comptes rendus de traitement',
      '• Extraction de données depuis des factures PDF',
      '• Suivi des statuts et erreurs',
      '• Monitoring des échanges API',
    ],
  },
  {
    id: 'apis',
    title: '4. Utilisation des APIs Chorus Pro / PISTE',
    content: [
      'Chorus Pilot s\'appuie sur les APIs Chorus Pro / PISTE pour transmettre ou consulter des données de facturation.',
      'L\'utilisateur doit disposer des habilitations, comptes et droits nécessaires pour utiliser ces services. Chorus Pilot ne peut pas suppléer aux manques d\'habilitations ou de droits auprès des entités publiques.',
      'L\'utilisateur accepte les conditions d\'utilisation des APIs Chorus Pro / PISTE en vigueur.',
    ],
  },
  {
    id: 'responsabilites',
    title: '5. Responsabilités de l\'utilisateur',
    content: [
      'L\'utilisateur doit vérifier l\'exactitude des données transmises, notamment :',
      '• SIRET fournisseur',
      '• SIRET destinataire',
      '• Montants HT / TVA / TTC',
      '• Références de facture',
      '• Format du flux',
      '• Pièces jointes',
      '• Informations nécessaires au traitement Chorus Pro',
      'L\'utilisateur est seul responsable de la conformité des données avec les normes Chorus Pro / PISTE et la réglementation en vigueur.',
    ],
  },
  {
    id: 'limites',
    title: '6. Limites du service',
    content: [
      'Chorus Pilot facilite l\'automatisation et le suivi, mais ne garantit pas l\'acceptation automatique d\'un flux par Chorus Pro. Un flux peut être rejeté pour des raisons techniques, fonctionnelles, réglementaires ou liées aux données fournies.',
      'Chorus Pilot est fourni à titre informatif et de facilitation. Il ne remplace pas une expertise métier ou juridique sur les obligations de facturation électronique.',
    ],
  },
  {
    id: 'disponibilite',
    title: '7. Disponibilité',
    content: [
      'Le service peut être temporairement indisponible pour :',
      '• Maintenance programmée ou corrective',
      '• Incident technique',
      '• Dépendance externe',
      '• Indisponibilité des APIs tierces (Chorus Pro, PISTE)',
      'Nous nous efforçons de réduire ces périodes, mais ne pouvons pas les exclure complètement.',
    ],
  },
  {
    id: 'donnees',
    title: '8. Données et confidentialité',
    content: [
      'Les données traitées peuvent inclure :',
      '• Informations de facturation (montants, références, dates)',
      '• Identifiants d\'entreprise (SIRET, SIREN)',
      '• Fichiers PDF, XML, UBL',
      '• Réponses API et comptes rendus de traitement',
      '• Métadonnées d\'utilisation et logs techniques',
      'Ces données doivent être protégées selon les règles internes de sécurité et la réglementation en vigueur (RGPD, etc.).',
    ],
  },
  {
    id: 'securite',
    title: '9. Sécurité',
    content: [
      'Les identifiants, tokens, comptes techniques, mots de passe et headers sensibles ne doivent jamais être :',
      '• Partagés ou communiqués à des tiers non autorisés',
      '• Exposés dans les logs ou les historiques',
      '• Stockés en clair dans des fichiers ou configurations',
      '• Utilisés de manière abusive',
      'L\'utilisateur s\'engage à signaler immédiatement tout accès suspect ou compromission d\'identifiants.',
    ],
  },
  {
    id: 'propriete',
    title: '10. Propriété intellectuelle',
    content: [
      'L\'interface, les développements spécifiques, les composants logiciels et les contenus de Chorus Pilot sont protégés par les droits de propriété intellectuelle applicables.',
      'L\'utilisateur ne doit pas copier, modifier, adapter, traduire, décompiler, redistribuer ou exploiter le service sans autorisation préalable.',
      'Toute reproduction ou utilisation non autorisée est interdite et peut entraîner des poursuites.',
    ],
  },
  {
    id: 'evolutions',
    title: '11. Évolutions du service',
    content: [
      'Chorus Pilot peut évoluer pour intégrer :',
      '• De nouvelles fonctionnalités',
      '• Nouveaux formats de flux',
      '• Nouveaux endpoints API',
      '• Améliorations de monitoring',
      '• Nouveaux connecteurs ou intégrations',
      'Les utilisateurs seront informés des évolutions majeures.',
    ],
  },
  {
    id: 'support',
    title: '12. Support et contact',
    content: [
      'Pour toute question relative à l\'utilisation de Chorus Pilot, veuillez contacter l\'équipe projet ou l\'administrateur de la plateforme.',
      'Vous trouverez les informations de contact dans la section "Paramètres" ou "À propos" de l\'application.',
      'En cas de problème urgent, signalez-le immédiatement à l\'administrateur système.',
    ],
  },
  {
    id: 'acceptation',
    title: '13. Acceptation des CGU',
    content: [
      'L\'utilisation de Chorus Pilot implique l\'acceptation intégrale et sans réserve des présentes Conditions Générales d\'Utilisation.',
      'Si vous n\'acceptez pas ces conditions, veuillez cesser l\'utilisation du service immédiatement.',
      'Le non-respect des présentes CGU peut entraîner la suspension ou la fermeture de votre accès à Chorus Pilot.',
    ],
  },
];

export default function CGUPage() {
  const lastUpdate = 'mai 2026';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Link to="/">
            <Button variant="ghost" size="sm" className="mb-4 gap-2">
              <ArrowLeft className="h-4 w-4" />
              Retour au tableau de bord
            </Button>
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-bold">
                  Conditions Générales d'Utilisation
                </h1>
                <Badge variant="secondary" className="shrink-0">Version provisoire</Badge>
              </div>
              <p className="text-lg text-muted-foreground">
                Les présentes conditions encadrent l'utilisation de Chorus Pilot, solution de pilotage et d'automatisation des flux Chorus Pro / PISTE.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Warning Alert */}
        <Alert className="mb-8 border-amber-200 bg-amber-50 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900 dark:text-amber-200">
            <strong>Document de travail :</strong> Ce document est un modèle et doit être validé juridiquement avant toute mise en production. Il n'a pas de valeur légale contractuelle à ce stade.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar - Table of Contents */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24 space-y-2">
              <p className="text-sm font-semibold text-muted-foreground px-3 mb-4">Sommaire</p>
              <nav className="space-y-1">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/10 rounded-md transition-colors"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>

              {/* Last update */}
              <div className="border-t border-border/40 mt-6 pt-4">
                <p className="text-xs text-muted-foreground">
                  Dernière mise à jour : {lastUpdate}
                </p>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="lg:col-span-3 space-y-8">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-24">
                <Card className="border border-border/60 hover:border-accent/50 transition-all">
                  <CardHeader>
                    <CardTitle className="text-xl">{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {section.content.map((paragraph, idx) => (
                      <p
                        key={idx}
                        className="text-muted-foreground leading-relaxed whitespace-pre-wrap"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              </section>
            ))}

            {/* Footer Section */}
            <Card className="border border-border/60 bg-accent/5">
              <CardHeader>
                <CardTitle className="text-lg">Acceptation et engagement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground leading-relaxed">
                  En accédant et en utilisant Chorus Pilot, vous acceptez les termes et conditions énoncés dans ce document. Si vous n'acceptez pas ces conditions, nous vous demandons de ne pas utiliser ce service.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <Link to="/">
                    <Button variant="outline" className="gap-2">
                      <ArrowLeft className="h-4 w-4" />
                      Retour au tableau de bord
                    </Button>
                  </Link>
                  <Button variant="ghost" disabled className="gap-2">
                    <Download className="h-4 w-4" />
                    Télécharger en PDF (Bientôt)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    </div>
  );
}
