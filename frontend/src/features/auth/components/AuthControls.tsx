"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAuthStore } from "../auth-store";

export function AuthControls() {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const signInOpen = useAuthStore((state) => state.signInOpen);
  const setSignInOpen = useAuthStore((state) => state.setSignInOpen);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const dialogId = useId();
  const headingId = useId();
  const descriptionId = useId();
  const emailId = useId();
  const passwordId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const isAuthenticating = status === "authenticating";

  useEffect(() => {
    if (signInOpen && !user) {
      emailInputRef.current?.focus();
    }
  }, [signInOpen, user]);

  useEffect(() => {
    if (!signInOpen || user) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSignInOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (dialogRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setSignInOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [signInOpen, user, setSignInOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signedIn = await login(email, password);
    if (signedIn) {
      setEmail("");
      setPassword("");
    }
  }

  function handleCloseDialog() {
    setSignInOpen(false);
    triggerRef.current?.focus();
  }

  if (user) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <div
          data-testid="auth-identity"
          aria-label={`Signed in as ${user.email} (${user.role})`}
          className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[#CFDDE0] bg-white px-2 py-1 text-xs text-[#0F292E]"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-[#0B6E4F]"
          />
          <span
            title={user.email}
            className="max-w-[82px] truncate font-medium text-[#0F292E] sm:max-w-[180px]"
          >
            {user.email}
          </span>
          <span
            data-testid="auth-role"
            className="shrink-0 rounded bg-[#E8F5F0] px-1.5 py-0.5 text-[11px] font-medium text-[#0A583E]"
          >
            {user.role}
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="shrink-0 rounded-lg border border-[#CFDDE0] bg-white px-2 py-1.5 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#EDF4F5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E] sm:px-2.5"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={signInOpen}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={() => setSignInOpen(!signInOpen)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D6E6E] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="8" cy="5.25" r="2.75" />
          <path
            d="M3 13.5c.6-2.4 2.5-3.75 5-3.75s4.4 1.35 5 3.75"
            strokeLinecap="round"
          />
        </svg>
        <span>Sign in</span>
      </button>

      {signInOpen && (
        <div
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          className="fixed top-14 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-[#CFDDE0] bg-[#FAFCFC] p-4 text-[#0F292E] shadow-lg sm:right-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2
                id={headingId}
                className="text-sm font-semibold tracking-tight text-[#0F292E]"
              >
                Sign in
              </h2>
              <p
                id={descriptionId}
                className="mt-0.5 text-xs leading-relaxed text-[#436066]"
              >
                Access protected survey history for selected sites. Public site
                browsing stays available without signing in.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCloseDialog}
              aria-label="Close sign-in dialog"
              className="rounded-md p-1 text-[#436066] transition-colors hover:bg-[#E7F1F2] hover:text-[#0F292E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path d="M4 4l8 8m0-8l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-[#E5B8AF] bg-[#FFF8F6] px-3 py-2 text-xs text-[#5E1E11]"
            >
              <p className="font-medium">{error.message}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-3 space-y-3">
            <div>
              <label
                htmlFor={emailId}
                className="block text-xs font-medium text-[#0F292E]"
              >
                Email
              </label>
              <input
                ref={emailInputRef}
                id={emailId}
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={isAuthenticating}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) clearError();
                }}
                placeholder="name@example.test"
                className="mt-1 block w-full rounded-lg border border-[#CFDDE0] bg-white px-2.5 py-2 text-sm text-[#0F292E] placeholder:text-[#789298] focus:border-[#0D6E6E] focus:outline-2 focus:outline-offset-0 focus:outline-[#0D6E6E]/30 disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor={passwordId}
                className="block text-xs font-medium text-[#0F292E]"
              >
                Password
              </label>
              <input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isAuthenticating}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) clearError();
                }}
                className="mt-1 block w-full rounded-lg border border-[#CFDDE0] bg-white px-2.5 py-2 text-sm text-[#0F292E] focus:border-[#0D6E6E] focus:outline-2 focus:outline-offset-0 focus:outline-[#0D6E6E]/30 disabled:opacity-60"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCloseDialog}
                disabled={isAuthenticating}
                className="rounded-lg border border-[#CFDDE0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#EDF4F5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAuthenticating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0D6E6E] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E] disabled:opacity-70"
              >
                {isAuthenticating && (
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                )}
                <span>{isAuthenticating ? "Signing in…" : "Sign in"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
