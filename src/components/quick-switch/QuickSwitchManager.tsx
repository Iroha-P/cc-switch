import { useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { sessionsApi } from "@/lib/api/sessions";
import { useProvidersQuery, useSessionsQuery } from "@/lib/query";
import { useProviderActions } from "@/hooks/useProviderActions";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type QuickSwitchAppId = Extract<AppId, "claude" | "codex">;

interface QuickSwitchApp {
  id: QuickSwitchAppId;
  title: string;
  description: string;
}

const QUICK_SWITCH_APPS: QuickSwitchApp[] = [
  {
    id: "claude",
    title: "Claude Code",
    description: "Claude account and API pool",
  },
  {
    id: "codex",
    title: "Codex CLI",
    description: "Codex CLI account and API pool",
  },
];

type AccountStatus = "available" | "used-up";
type AccountStatusMap = Record<string, AccountStatus>;

const ACCOUNT_STATUS_STORAGE_KEY = "cc-switch.quick-switch.account-status";

const accountKey = (appId: QuickSwitchAppId, providerId: string) =>
  `${appId}:${providerId}`;

function readAccountStatuses(): AccountStatusMap {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(ACCOUNT_STATUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as AccountStatusMap;
  } catch {
    return {};
  }
}

function writeAccountStatuses(statuses: AccountStatusMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ACCOUNT_STATUS_STORAGE_KEY,
    JSON.stringify(statuses),
  );
}

const sortForRotation = (
  providers: Record<string, Provider>,
  currentProviderId: string,
) => {
  return Object.values(providers).sort((left, right) => {
    if (left.id === currentProviderId) return -1;
    if (right.id === currentProviderId) return 1;
    return (left.sortIndex ?? 0) - (right.sortIndex ?? 0);
  });
};

function detectAccountKind(provider: Provider) {
  const config = provider.settingsConfig as Record<string, any>;
  const env = config?.env as Record<string, any> | undefined;

  if (
    provider.meta?.authBinding?.source === "managed_account" ||
    provider.meta?.providerType === "codex_oauth" ||
    provider.meta?.providerType === "github_copilot"
  ) {
    return "Account Login";
  }

  if (
    typeof env?.ANTHROPIC_API_KEY === "string" ||
    typeof env?.ANTHROPIC_AUTH_TOKEN === "string" ||
    typeof config?.OPENAI_API_KEY === "string"
  ) {
    return "API Key";
  }

  if (typeof config?.auth === "string") {
    try {
      const auth = JSON.parse(config.auth);
      if (typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
        return "API Key";
      }
    } catch {
      if (config.auth.includes("OPENAI_API_KEY")) return "API Key";
    }
  }

  return provider.category === "official" ? "Account Login" : "Local Config";
}

function getProviderEndpoint(provider: Provider) {
  if (provider.notes?.trim()) return provider.notes.trim();
  if (provider.websiteUrl?.trim()) return provider.websiteUrl.trim();

  const config = provider.settingsConfig as Record<string, any>;
  const envBase = config?.env?.ANTHROPIC_BASE_URL;
  if (typeof envBase === "string" && envBase.trim()) return envBase.trim();

  const codexConfig = config?.config;
  if (typeof codexConfig === "string") {
    const match = codexConfig.match(/base_url\s*=\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1];
  }

  return "Official login or local config";
}

interface QuickSwitchSectionProps {
  app: QuickSwitchApp;
  accountStatuses: AccountStatusMap;
  onStatusChange: (
    appId: QuickSwitchAppId,
    providerId: string,
    status: AccountStatus,
  ) => void;
}

function QuickSwitchSection({
  app,
  accountStatuses,
  onStatusChange,
}: QuickSwitchSectionProps) {
  const { data, isLoading } = useProvidersQuery(app.id);
  const { data: sessions = [] } = useSessionsQuery();
  const { switchProvider } = useProviderActions(app.id, false, false);

  const providers = data?.providers ?? {};
  const currentProviderId = data?.currentProviderId ?? "";
  const orderedProviders = useMemo(
    () => sortForRotation(providers, currentProviderId),
    [providers, currentProviderId],
  );
  const currentProvider = providers[currentProviderId];

  const handleSwitch = async (provider: Provider) => {
    await switchProvider(provider);
  };

  const getStatus = (providerId: string): AccountStatus =>
    accountStatuses[accountKey(app.id, providerId)] ?? "available";

  const latestSession = useMemo(() => {
    return sessions
      .filter((session) => session.providerId === app.id)
      .sort((left, right) => {
        const leftAt = left.lastActiveAt ?? left.createdAt ?? 0;
        const rightAt = right.lastActiveAt ?? right.createdAt ?? 0;
        return rightAt - leftAt;
      })[0];
  }, [app.id, sessions]);

  const findNextAvailableProvider = () => {
    const candidates = orderedProviders.filter(
      (provider) =>
        provider.id !== currentProviderId &&
        getStatus(provider.id) !== "used-up",
    );
    if (candidates.length === 0) return null;

    const currentIndex = orderedProviders.findIndex(
      (provider) => provider.id === currentProviderId,
    );
    if (currentIndex < 0) return candidates[0];

    return (
      candidates.find((provider) => {
        const index = orderedProviders.findIndex(
          (item) => item.id === provider.id,
        );
        return index > currentIndex;
      }) ?? candidates[0]
    );
  };

  const handleSwitchNextAndResume = async () => {
    const nextProvider = findNextAvailableProvider();
    if (!nextProvider) {
      toast.error(`No available ${app.title} account to switch to`);
      return;
    }

    await switchProvider(nextProvider);

    try {
      if (latestSession?.resumeCommand) {
        await sessionsApi.launchTerminal({
          command: latestSession.resumeCommand,
          cwd: latestSession.projectDir ?? undefined,
        });
        toast.success(`Switched to ${nextProvider.name} and resumed session`);
        return;
      }

      await providersApi.openTerminal(nextProvider.id, app.id);
      toast.success(`Switched to ${nextProvider.name} and opened terminal`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Switched account, but failed to resume ${app.title}`,
      );
    }
  };

  const handleMarkCurrentUsedUpAndResume = async () => {
    if (!currentProvider) {
      await handleSwitchNextAndResume();
      return;
    }

    onStatusChange(app.id, currentProvider.id, "used-up");
    await handleSwitchNextAndResume();
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      await providersApi.openTerminal(provider.id, app.id);
      toast.success(`Opened ${app.title} terminal with ${provider.name}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to open ${app.title} terminal`,
      );
    }
  };

  return (
    <section
      data-testid={`quick-switch-${app.id}`}
      className="flex min-h-0 flex-col rounded-lg border border-border bg-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold leading-tight">
              {app.title}
            </h2>
            <Badge variant="secondary" className="rounded-md px-1.5 py-0">
              {orderedProviders.length}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {app.description}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleMarkCurrentUsedUpAndResume()}
            disabled={!currentProvider || orderedProviders.length < 2}
            aria-label={`mark current ${app.title} account as used up and continue with next available account`}
            className="h-8"
          >
            <Ban className="h-4 w-4" />
            <span className="hidden xl:inline">Use next</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSwitchNextAndResume()}
            disabled={orderedProviders.length < 2}
            aria-label={`switch ${app.title} to next available account and resume session`}
            className="h-8"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden xl:inline">Next</span>
          </Button>
          {currentProvider && (
            <div className="max-w-[12rem] text-right text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Current</div>
              <div className="truncate" title={currentProvider.name}>
                {currentProvider.name}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading accounts
          </div>
        ) : orderedProviders.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            <KeyRound className="mb-2 h-5 w-5" />
            No accounts configured yet.
          </div>
        ) : (
          <div className="space-y-2">
            {orderedProviders.map((provider) => {
              const isCurrent = provider.id === currentProviderId;
              const status = getStatus(provider.id);
              const isUsedUp = status === "used-up";
              return (
                <article
                  key={provider.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                    isUsedUp
                      ? "border-amber-500/50 bg-amber-500/5"
                      : isCurrent
                        ? "border-blue-500/60 bg-blue-500/5"
                        : "border-border bg-background hover:border-border-active",
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <ProviderIcon
                      icon={provider.icon}
                      name={provider.name}
                      color={provider.iconColor}
                      size={20}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-6 flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium">
                        {provider.name}
                      </h3>
                      {isCurrent && (
                        <Badge
                          variant="default"
                          className="rounded-md px-1.5 py-0 text-[10px]"
                        >
                          Current
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="rounded-md px-1.5 py-0 text-[10px]"
                      >
                        {detectAccountKind(provider)}
                      </Badge>
                      {isUsedUp && (
                        <Badge
                          variant="secondary"
                          className="rounded-md px-1.5 py-0 text-[10px]"
                        >
                          Used up
                        </Badge>
                      )}
                    </div>
                    <p
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={getProviderEndpoint(provider)}
                    >
                      {getProviderEndpoint(provider)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onStatusChange(
                          app.id,
                          provider.id,
                          isUsedUp ? "available" : "used-up",
                        )
                      }
                      aria-label={
                        isUsedUp
                          ? `mark ${provider.name} as available`
                          : `mark ${provider.name} as used up`
                      }
                      className="h-8 w-8 px-0"
                    >
                      {isUsedUp ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Ban className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant={isCurrent ? "secondary" : "default"}
                      size="sm"
                      disabled={isCurrent || isUsedUp}
                      onClick={() => void handleSwitch(provider)}
                      aria-label={`switch to ${provider.name} for ${app.title}`}
                      className="h-8"
                    >
                      {isCurrent ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleOpenTerminal(provider)}
                      aria-label={`open terminal for ${provider.name} with ${app.title}`}
                      className="h-8 w-8 px-0"
                    >
                      <Terminal className="h-4 w-4" />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default function QuickSwitchManager() {
  const [accountStatuses, setAccountStatuses] = useState<AccountStatusMap>(() =>
    readAccountStatuses(),
  );

  const handleStatusChange = (
    appId: QuickSwitchAppId,
    providerId: string,
    status: AccountStatus,
  ) => {
    setAccountStatuses((current) => {
      const next = { ...current };
      const key = accountKey(appId, providerId);
      if (status === "available") {
        delete next[key];
      } else {
        next[key] = status;
      }
      writeAccountStatuses(next);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Quick Switch</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage Claude Code and Codex CLI accounts from one rotation desk.
            Desktop clients are not switched from this panel.
          </p>
        </div>
      </div>
      <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Unified Account Pool</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Mark exhausted accounts, then switch to the next available account
              while keeping local sessions resumable.
            </p>
          </div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 pb-12 lg:grid-cols-2">
        {QUICK_SWITCH_APPS.map((app) => (
          <QuickSwitchSection
            key={app.id}
            app={app}
            accountStatuses={accountStatuses}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  );
}
