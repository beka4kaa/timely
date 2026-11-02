export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://app.timely-plan.study";

export const appLink = (path = "") => `${APP_URL}${path}`;
