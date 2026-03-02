import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";

export function renderCortexLoginScreen(state: AppViewState) {
  const isLoading = state.cortexLoginLoading;
  const error = state.cortexLoginError;
  const status = state.cortexLoginStatus;

  return html`
    <div class="cortex-login">
      <!-- Animated background -->
      <div class="cortex-login-bg">
        <div class="cortex-login-bg-orb cortex-login-bg-orb--1"></div>
        <div class="cortex-login-bg-orb cortex-login-bg-orb--2"></div>
        <div class="cortex-login-bg-grid"></div>
        <div class="cortex-login-bg-fade"></div>
      </div>

      <!-- Content -->
      <div class="cortex-login-content">
        <!-- Orb -->
        <div class="cortex-orb-wrapper">
          <div class="cortex-orb ${isLoading ? "cortex-orb--thinking" : ""}">
            <div class="cortex-orb-glow"></div>
            <div class="cortex-orb-ring"></div>
            <div class="cortex-orb-sphere">
              <div class="cortex-orb-highlight"></div>
              <div class="cortex-orb-inner-ring"></div>
            </div>
          </div>
        </div>

        <!-- Heading -->
        <h1 class="cortex-login-title">Athena</h1>
        <p class="cortex-login-subtitle">Sign in to your account</p>

        <!-- Glass card -->
        <div class="cortex-login-card">
          ${error ? html`<div class="cortex-login-error">${error}</div>` : nothing}

          ${status ? html`<div class="cortex-login-status">${status}</div>` : nothing}

          <button
            class="cortex-login-button"
            ?disabled=${isLoading}
            @click=${() => state.handleCortexLogin()}
          >
            ${isLoading ? "Signing in\u2026" : "Sign in with Okta"}
          </button>
        </div>
      </div>
    </div>
  `;
}
