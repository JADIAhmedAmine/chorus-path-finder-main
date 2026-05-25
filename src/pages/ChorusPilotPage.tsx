import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Zap, FileUp, PieChart, Database, FileText, Activity,
  ArrowRight, CheckCircle2, Clock, AlertCircle, BookOpen,
  Send, Eye, Paperclip
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FeatureCard {
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  route?: string;
  disabled?: boolean;
}

const features: FeatureCard[] = [
  {
    icon: <FileUp className="h-6 w-6 text-accent" />,
    title: 'Dépôt de flux',
    description: 'Dépôt de fichiers XML / UBL via l\'API /v1/deposer/flux.',
  },
  {
    icon: <Database className="h-6 w-6 text-accent" />,
    title: 'Formats & syntaxes',
    description: 'Récupération des formats disponibles et des syntaxes via les APIs dédiées.',
  },
  {
    icon: <FileText className="h-6 w-6 text-accent" />,
    title: 'Compte rendu',
    description: 'Consultation du compte rendu de traitement via /v1/consulterCR.',
  },
  {
    icon: <PieChart className="h-6 w-6 text-accent" />,
    title: 'Chorus Pro / PISTE',
    description: 'Intégration complète avec les APIs Chorus Pro exposées via PISTE.',
  },
  {
    icon: <Paperclip className="h-6 w-6 text-accent" />,
    title: 'Extraction PDF',
    description: 'Extraction de données depuis factures PDF pour préparer des flux structurés.',
  },
  {
    icon: <Activity className="h-6 w-6 text-accent" />,
    title: 'Monitoring',
    description: 'Suivi des statuts, erreurs, rejets, réponses API et traitements de flux.',
  },
];

const workflows = [
  { step: 'PDF / Facture', icon: <FileText className="h-4 w-4" /> },
  { step: 'Extraction', icon: <Zap className="h-4 w-4" /> },
  { step: 'Données structurées', icon: <Database className="h-4 w-4" /> },
  { step: 'XML / UBL', icon: <FileUp className="h-4 w-4" /> },
  { step: 'Dépôt Chorus Pro', icon: <Send className="h-4 w-4" /> },
  { step: 'Compte rendu', icon: <FileText className="h-4 w-4" /> },
  { step: 'Suivi statut', icon: <Activity className="h-4 w-4" /> },
];

const apis: ApiEndpoint[] = [
  {
    method: 'POST',
    path: '/v1/recuperer/formatflux',
    description: 'Récupérer les formats de flux disponibles.',
  },
  {
    method: 'POST',
    path: '/v1/recuperer/syntaxeflux',
    description: 'Récupérer les syntaxes XML possibles selon le format choisi.',
  },
  {
    method: 'POST',
    path: '/v1/deposer/flux',
    description: 'Déposer un flux facture XML ou PDF/A3.',
  },
  {
    method: 'POST',
    path: '/v1/consulterCR',
    description: 'Consulter le compte rendu de traitement du flux déposé.',
  },
];

const quickActions: QuickAction[] = [
  {
    label: 'Voir formats de flux',
    icon: <Eye className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: 'Voir syntaxes UBL / CII',
    icon: <BookOpen className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: 'Déposer un flux',
    icon: <FileUp className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: 'Consulter compte rendu',
    icon: <FileText className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: 'Ouvrir monitoring',
    icon: <Activity className="h-4 w-4" />,
    route: '/monitoring',
  },
];

export default function ChorusPilotPage() {
  const [copiedApi, setCopiedApi] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedApi(text);
    setTimeout(() => setCopiedApi(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-12 md:py-24">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-accent rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-10 w-72 h-72 bg-primary rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative z-10 mx-auto max-w-5xl px-4 text-center">
          <div className="mb-6 flex justify-center">
            <img 
              src="/app-symbol.svg" 
              alt="Chorus Pilot" 
              className="h-32 w-32 md:h-40 md:w-40 opacity-90 hover:opacity-100 transition-opacity"
            />
          </div>

          <Badge className="mb-4 bg-accent/20 text-accent hover:bg-accent/30 border-accent/30">
            Automatisation & Pilotage
          </Badge>
          
          <h1 className="mb-4 text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
            Chorus Pilot
          </h1>
          
          <p className="mb-6 text-xl text-muted-foreground md:text-2xl">
            Pilotage intelligent des flux Chorus Pro / PISTE pour la facturation électronique du secteur public.
          </p>
          
          <p className="mx-auto mb-8 max-w-2xl text-base md:text-lg text-muted-foreground leading-relaxed">
            Centralisez vos dépôts, contrôlez vos flux, suivez les retours Chorus Pro et automatisez les échanges avec les entités publiques.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/monitoring">
              <Button size="lg" className="gap-2">
                <Activity className="h-4 w-4" />
                Accéder au Monitoring
              </Button>
            </Link>
            <Button size="lg" variant="outline">
              Documentation
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 md:py-24 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ce que fait Chorus Pilot
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Une suite complète de fonctionnalités pour automatiser et piloter vos flux de facturation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="border border-border/60 hover:border-accent/50 transition-all hover:shadow-lg lift-on-hover">
                <CardHeader>
                  <div className="mb-2 inline-flex rounded-lg bg-accent/10 p-2.5">
                    {feature.icon}
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow Section */}
      <section className="py-12 md:py-24 px-4 bg-card/40">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Flux de traitement
            </h2>
            <p className="text-muted-foreground text-lg">
              Parcours complet d'une facture, du document source au suivi de dépôt.
            </p>
          </div>

          <div className="relative">
            <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3 flex-wrap">
              {workflows.map((workflow, index) => (
                <div key={index} className="flex items-center gap-2 md:gap-3">
                  <div className="flex flex-col items-center">
                    <div className="rounded-full bg-accent/20 p-3 border border-accent/30">
                      {workflow.icon}
                    </div>
                    <span className="mt-2 text-xs text-center font-medium whitespace-nowrap max-w-20">
                      {workflow.step}
                    </span>
                  </div>
                  {index < workflows.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-accent/50 hidden md:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* APIs Section */}
      <section className="py-12 md:py-24 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              APIs clés
            </h2>
            <p className="text-muted-foreground text-lg">
              Points d'intégration pour la gestion complète des flux Chorus.
            </p>
          </div>

          <div className="space-y-3">
            {apis.map((api, index) => (
              <Card
                key={index}
                className="border border-border/60 hover:border-accent/50 transition-all cursor-pointer lift-on-hover"
                onClick={() => copyToClipboard(api.path)}
              >
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant="secondary" className="font-mono">
                          {api.method}
                        </Badge>
                        <code className="text-sm font-mono text-accent select-all">
                          {api.path}
                        </code>
                      </div>
                      <p className="text-sm text-muted-foreground">{api.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(api.path);
                      }}
                    >
                      {copiedApi === api.path ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Actions Section */}
      <section className="py-12 md:py-24 px-4 bg-card/40">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Actions rapides
            </h2>
            <p className="text-muted-foreground text-lg">
              Accédez rapidement aux fonctionnalités principales.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {quickActions.map((action, index) => (
              <div key={index}>
                {action.route ? (
                  <Link to={action.route} className="block">
                    <Button
                      size="lg"
                      variant="outline"
                      className="w-full h-auto flex flex-col items-center justify-center gap-2 py-4 hover:border-accent hover:text-accent transition-all"
                    >
                      {action.icon}
                      <span className="text-xs text-center">{action.label}</span>
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={action.disabled}
                    className="w-full h-auto flex flex-col items-center justify-center gap-2 py-4"
                  >
                    {action.icon}
                    <span className="text-xs text-center">{action.label}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>

          {quickActions.some(a => a.disabled) && (
            <Alert className="mt-8 border-info/50 bg-info/5">
              <Clock className="h-4 w-4 text-info" />
              <AlertDescription>
                Certaines fonctionnalités arrivent bientôt. Consultez la documentation pour en savoir plus.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 md:py-24 px-4">
        <div className="mx-auto max-w-4xl">
          <Card className="border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-primary/5">
            <CardContent className="pt-12 pb-12">
              <div className="text-center">
                <div className="mb-4 inline-flex rounded-lg bg-accent/20 p-3">
                  <Zap className="h-6 w-6 text-accent" />
                </div>
                <h3 className="mb-4 text-2xl md:text-3xl font-bold">
                  Prêt à automatiser vos flux ?
                </h3>
                <p className="mb-8 text-muted-foreground text-lg">
                  Chorus Pilot vous accompagne à chaque étape de votre automatisation.
                </p>
                <Link to="/monitoring">
                  <Button size="lg" className="gap-2">
                    <Activity className="h-4 w-4" />
                    Accéder au tableau de suivi
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
