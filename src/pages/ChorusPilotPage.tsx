import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileText,
  FileUp,
  LineChart,
  Paperclip,
  Send,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface FeatureCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  tone: 'primary' | 'success' | 'warning' | 'info';
}

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

interface QuickAction {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  route?: string;
  disabled?: boolean;
}

const features: FeatureCard[] = [
  {
    icon: FileUp,
    title: 'Dépôt de flux',
    description: 'Soumission de fichiers XML / UBL ou PDF/A-3 via l’API /v1/deposer/flux avec validation locale avant envoi.',
    tone: 'primary',
  },
  {
    icon: Database,
    title: 'Formats & syntaxes',
    description: 'Découverte automatique des formats et syntaxes acceptés par Chorus Pro — toujours à jour.',
    tone: 'info',
  },
  {
    icon: FileText,
    title: 'Comptes rendus',
    description: 'Lecture des comptes rendus de traitement (/v1/consulterCR) avec mise en lisible des erreurs PISTE.',
    tone: 'success',
  },
  {
    icon: LineChart,
    title: 'Pilotage Chorus Pro',
    description: 'Intégration complète avec les APIs Chorus exposées via PISTE — vue temps réel sur les statuts.',
    tone: 'primary',
  },
  {
    icon: Paperclip,
    title: 'Extraction PDF',
    description: 'Pré-remplissage des flux structurés à partir de factures PDF — gain de temps sur la ressaisie.',
    tone: 'warning',
  },
  {
    icon: Activity,
    title: 'Monitoring & audit',
    description: 'Suivi des statuts, rejets, recyclages et traitements — historique horodaté par utilisateur.',
    tone: 'info',
  },
];

const workflows = [
  { step: 'PDF / Facture', icon: FileText },
  { step: 'Extraction', icon: Zap },
  { step: 'Données structurées', icon: Database },
  { step: 'XML / UBL', icon: FileUp },
  { step: 'Dépôt Chorus Pro', icon: Send },
  { step: 'Compte rendu', icon: FileText },
  { step: 'Suivi statut', icon: Activity },
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
    description: 'Déposer un flux facture XML ou PDF/A-3.',
  },
  {
    method: 'POST',
    path: '/v1/consulterCR',
    description: 'Consulter le compte rendu de traitement du flux déposé.',
  },
];

const quickActions: QuickAction[] = [
  {
    label: 'Nouvelle émission',
    description: 'Préparer et soumettre une facture',
    icon: Send,
    route: '/invoices/new',
  },
  {
    label: 'Suivi émissions',
    description: 'Voir toutes les factures émises',
    icon: FileText,
    route: '/invoices',
  },
  {
    label: 'Rejets / refus',
    description: 'Analyser les motifs de rejet',
    icon: AlertCircle,
    route: '/invoices/rejections',
  },
  {
    label: 'Monitoring',
    description: 'Historique des actions',
    icon: Activity,
    route: '/monitoring',
  },
  {
    label: 'Documentation',
    description: 'Bientôt disponible',
    icon: BookOpen,
    disabled: true,
  },
];

const stats = [
  { value: 'PISTE', label: 'Intégration native', icon: Shield },
  { value: '100%', label: 'API Chorus couvertes', icon: CheckCircle2 },
  { value: '< 1s', label: 'Soumission flux', icon: Zap },
];

const TONE_STYLES: Record<FeatureCard['tone'], { iconBg: string; iconColor: string; ring: string }> = {
  primary: { iconBg: 'bg-primary/10', iconColor: 'text-primary', ring: 'group-hover:border-primary/40' },
  success: { iconBg: 'bg-success-soft', iconColor: 'text-success', ring: 'group-hover:border-success/40' },
  warning: { iconBg: 'bg-warning-soft', iconColor: 'text-warning', ring: 'group-hover:border-warning/40' },
  info: { iconBg: 'bg-info-soft', iconColor: 'text-info', ring: 'group-hover:border-info/40' },
};

export default function ChorusPilotPage() {
  const [copiedApi, setCopiedApi] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedApi(text);
    setTimeout(() => setCopiedApi(null), 1500);
  };

  return (
    <div className="-mx-5 -my-6 min-h-full bg-background sm:-mx-8 sm:-my-8">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        {/* Grid pattern */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 60% 60% at 50% 0%, black 30%, transparent 75%)',
          }}
        />
        {/* Blobs */}
        <div className="pointer-events-none absolute -top-32 left-1/4 -z-10 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/30 opacity-30 blur-[120px]" />
        <div className="pointer-events-none absolute -top-20 right-1/4 -z-10 h-[420px] w-[420px] translate-x-1/2 rounded-full bg-[hsl(262_83%_58%)] opacity-20 blur-[120px]" />

        <div className="mx-auto max-w-5xl px-4 pb-16 pt-16 text-center sm:pb-24 sm:pt-24">
          {/* Logo — original brand symbol preserved */}
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 -m-4 rounded-3xl bg-gradient-to-br from-primary/20 to-[hsl(262_83%_58%)/_0.2] blur-2xl" />
              <img
                src="/app-symbol.svg"
                alt="Chorus Pilot"
                className="relative h-32 w-32 md:h-40 md:w-40"
              />
            </div>
          </div>

          {/* Eyebrow badge */}
          <div className="mb-5 flex justify-center">
            <Badge className="gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-medium text-primary hover:bg-primary/15">
              <Sparkles className="h-3.5 w-3.5" />
              Automatisation & Pilotage
            </Badge>
          </div>

          {/* Title */}
          <h1 className="mb-5 text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl lg:text-[64px]">
            Chorus Pilot
          </h1>

          {/* Subtitle */}
          <p className="mb-4 text-xl text-muted-foreground md:text-2xl">
            Pilotage intelligent des flux Chorus Pro / PISTE pour la facturation électronique du secteur public.
          </p>
          <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Centralisez vos dépôts, contrôlez vos flux, suivez les retours Chorus Pro et automatisez les échanges avec les entités publiques.
          </p>

          {/* CTAs */}
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="h-11 gap-2 shadow-lifted">
              <Link to="/">
                <LineChart className="h-4 w-4" />
                Ouvrir le tableau de bord
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-11 gap-2">
              <Link to="/invoices/new">
                <Send className="h-4 w-4" />
                Nouvelle émission
              </Link>
            </Button>
          </div>

          {/* Stats row */}
          <div className="mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border bg-card/80 px-4 py-3 text-left shadow-soft backdrop-blur"
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <stat.icon className="h-3.5 w-3.5 text-primary" />
                  {stat.label}
                </div>
                <div className="mt-1 text-2xl font-bold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <Badge variant="outline" className="mb-3 rounded-full font-medium uppercase tracking-wider text-muted-foreground">
              Fonctionnalités
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Ce que fait Chorus Pilot
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
              Une suite complète pour automatiser et piloter vos flux de facturation publique.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => {
              const styles = TONE_STYLES[feature.tone];
              return (
                <div
                  key={index}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card',
                    styles.ring,
                  )}
                >
                  <div
                    className={cn(
                      'pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl opacity-50',
                      styles.iconBg,
                    )}
                  />
                  <div className={cn('relative mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl', styles.iconBg)}>
                    <feature.icon className={cn('h-5 w-5', styles.iconColor)} />
                  </div>
                  <h3 className="relative text-[15px] font-semibold text-foreground">{feature.title}</h3>
                  <p className="relative mt-1.5 text-[13px] leading-6 text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="border-y bg-muted/30 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <Badge variant="outline" className="mb-3 rounded-full font-medium uppercase tracking-wider text-muted-foreground">
              Parcours
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Flux de traitement</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
              Parcours complet d’une facture, du document source au suivi de dépôt Chorus.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center gap-3 lg:flex-row lg:flex-wrap">
            {workflows.map((workflow, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div className="relative">
                    <div className="absolute inset-0 -m-1 rounded-full bg-primary/15 blur-md" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full border bg-card shadow-soft">
                      <workflow.icon className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <span className="mt-2 max-w-[100px] text-center text-[11.5px] font-medium leading-tight text-foreground">
                    {workflow.step}
                  </span>
                </div>
                {index < workflows.length - 1 && (
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/60 lg:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* APIs */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <Badge variant="outline" className="mb-3 rounded-full font-medium uppercase tracking-wider text-muted-foreground">
              Intégration
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">APIs clés</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
              Points d’intégration pour la gestion complète des flux Chorus.
            </p>
          </div>

          <div className="space-y-2.5">
            {apis.map((api) => {
              const copied = copiedApi === api.path;
              return (
                <button
                  type="button"
                  key={api.path}
                  onClick={() => copyToClipboard(api.path)}
                  className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-card"
                >
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10.5px]">
                    {api.method}
                  </Badge>
                  <code className="flex-1 truncate font-mono text-[13px] font-medium text-foreground">
                    {api.path}
                  </code>
                  <span className="hidden text-[12.5px] text-muted-foreground md:inline">
                    {api.description}
                  </span>
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      copied ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                    )}
                    aria-label="Copier"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="border-t bg-muted/30 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <Badge variant="outline" className="mb-3 rounded-full font-medium uppercase tracking-wider text-muted-foreground">
              Raccourcis
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Actions rapides</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
              Accédez en un clic aux fonctionnalités principales.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {quickActions.map((action, index) => {
              const content = (
                <div
                  className={cn(
                    'group flex h-full flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-soft transition-all',
                    action.disabled
                      ? 'opacity-50'
                      : 'hover:-translate-y-px hover:border-primary/40 hover:shadow-card',
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <action.icon className="h-4 w-4" />
                  </div>
                  <span className="text-[13px] font-semibold text-foreground">{action.label}</span>
                  <span className="text-[11.5px] leading-snug text-muted-foreground">{action.description}</span>
                </div>
              );
              return action.route ? (
                <Link to={action.route} key={index}>
                  {content}
                </Link>
              ) : (
                <div key={index} aria-disabled>{content}</div>
              );
            })}
          </div>

          {quickActions.some((a) => a.disabled) && (
            <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-info/30 bg-info-soft/40 px-4 py-3 text-[12.5px] text-info">
              <Clock className="h-4 w-4 shrink-0" />
              <span>Certaines fonctionnalités arrivent bientôt. La documentation détaillée sera disponible en parallèle.</span>
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <Card className="relative overflow-hidden border-0 shadow-lifted">
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-[hsl(245_82%_50%)] to-[hsl(262_83%_50%)]" />
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.25), transparent 50%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.15), transparent 50%)',
              }}
            />
            <CardContent className="relative px-6 py-14 text-center sm:px-12">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <h3 className="mb-3 text-2xl font-bold leading-tight text-white sm:text-3xl">
                Prêt à automatiser vos flux ?
              </h3>
              <p className="mx-auto mb-7 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                Chorus Pilot vous accompagne à chaque étape : dépôt, suivi, correction, paiement.
              </p>
              <div className="flex flex-col items-center justify-center gap-2.5 sm:flex-row">
                <Button asChild size="lg" variant="secondary" className="h-11 gap-2 bg-white text-primary hover:bg-white/90">
                  <Link to="/">
                    <LineChart className="h-4 w-4" />
                    Ouvrir le tableau de bord
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="h-11 gap-2 text-white hover:bg-white/10 hover:text-white">
                  <Link to="/monitoring">
                    <Activity className="h-4 w-4" />
                    Voir le monitoring
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

