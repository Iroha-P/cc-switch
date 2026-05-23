import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickSwitchManager from "@/components/quick-switch/QuickSwitchManager";
import { sessionsApi } from "@/lib/api/sessions";
import {
  resetProviderState,
  setProviders,
  setSessionFixtures,
} from "../msw/state";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

const renderQuickSwitch = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <QuickSwitchManager />
    </QueryClientProvider>,
  );
};

describe("QuickSwitchManager", () => {
  beforeEach(() => {
    resetProviderState();
    localStorage.clear();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    toastWarningMock.mockReset();
    vi.restoreAllMocks();
  });

  it("shows Claude and Codex account pools and switches the selected account", async () => {
    renderQuickSwitch();

    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(await screen.findByText("Codex CLI")).toBeInTheDocument();
    expect(screen.getAllByText("Claude Default").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex Default").length).toBeGreaterThan(0);
    expect(screen.getByText("Codex Secondary")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /switch to Codex Secondary for Codex CLI/i,
      }),
    );

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });

    const codexSection = screen.getByTestId("quick-switch-codex");
    expect(codexSection.textContent).toContain("Current");
    expect(codexSection.textContent).toContain("Codex Secondary");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("skips used-up accounts and resumes the latest session when switching next", async () => {
    const launchTerminalSpy = vi
      .spyOn(sessionsApi, "launchTerminal")
      .mockResolvedValue(true);

    setProviders("codex", {
      "codex-1": {
        id: "codex-1",
        name: "Codex API Key",
        settingsConfig: {
          auth: JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
          config: 'model_provider = "openai"\nmodel = "gpt-5.3-codex"',
        },
        category: "custom",
        sortIndex: 0,
        createdAt: 1,
      },
      "codex-2": {
        id: "codex-2",
        name: "Codex Account Login",
        settingsConfig: {},
        meta: {
          authBinding: {
            source: "managed_account",
            authProvider: "codex_oauth",
            accountId: "chatgpt-1",
          },
        },
        category: "official",
        sortIndex: 1,
        createdAt: 2,
      },
      "codex-3": {
        id: "codex-3",
        name: "Codex Backup Key",
        settingsConfig: {
          auth: JSON.stringify({ OPENAI_API_KEY: "sk-backup" }),
          config: 'model_provider = "backup"\nmodel = "gpt-5.3-codex"',
        },
        category: "custom",
        sortIndex: 2,
        createdAt: 3,
      },
    });

    renderQuickSwitch();

    expect(await screen.findByText("Unified Account Pool")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Codex API Key")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Codex Account Login")).toBeInTheDocument();
    expect(screen.getAllByText("API Key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Account Login").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: /mark Codex Account Login as used up/i,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /switch Codex CLI to next available account and resume session/i,
      }),
    );

    await waitFor(() => {
      expect(launchTerminalSpy).toHaveBeenCalledWith({
        command: "codex resume codex-session-1",
        cwd: "/mock/codex",
      });
    });

    const codexSection = screen.getByTestId("quick-switch-codex");
    expect(codexSection.textContent).toContain("Codex Backup Key");
    expect(codexSection.textContent).toContain("Used up");
  });

  it("marks the current account used up and continues with the next account in one action", async () => {
    const launchTerminalSpy = vi
      .spyOn(sessionsApi, "launchTerminal")
      .mockResolvedValue(true);

    renderQuickSwitch();

    expect(
      (await screen.findAllByText("Codex Default")).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: /mark current Codex CLI account as used up and continue with next available account/i,
      }),
    );

    await waitFor(() => {
      expect(launchTerminalSpy).toHaveBeenCalledWith({
        command: "codex resume codex-session-1",
        cwd: "/mock/codex",
      });
    });

    const codexSection = screen.getByTestId("quick-switch-codex");
    expect(codexSection.textContent).toContain("Codex Secondary");
    expect(codexSection.textContent).toContain("Used up");
  });

  it("automatically detects Codex CLI quota exhaustion and switches to the next account", async () => {
    const launchTerminalSpy = vi
      .spyOn(sessionsApi, "launchTerminal")
      .mockResolvedValue(true);

    setSessionFixtures(
      [
        {
          providerId: "codex",
          sessionId: "codex-quota-session",
          title: "Codex quota session",
          projectDir: "/mock/codex",
          createdAt: Date.now() - 2000,
          lastActiveAt: Date.now() - 1000,
          sourcePath: "/mock/codex/quota-session.jsonl",
          resumeCommand: "codex resume codex-quota-session",
        },
      ],
      {
        "codex:/mock/codex/quota-session.jsonl": [
          {
            role: "assistant",
            content:
              "Request failed: insufficient_quota. You exceeded your current quota, please check your plan and billing details.",
            ts: Date.now(),
          },
        ],
      },
    );

    renderQuickSwitch();

    expect(
      await screen.findByRole("button", {
        name: /toggle Codex CLI quota auto switch/i,
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        expect.stringContaining("Detected Codex CLI quota limit"),
      );
    });

    await waitFor(() => {
      expect(launchTerminalSpy).toHaveBeenCalledWith({
        command: "codex resume codex-quota-session",
        cwd: "/mock/codex",
      });
    });

    const codexSection = screen.getByTestId("quick-switch-codex");
    expect(codexSection.textContent).toContain("Codex Secondary");
    expect(codexSection.textContent).toContain("Used up");
  });
});
