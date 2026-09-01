export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? String(values[i]) : ""),
    "",
  );
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function formatFolioDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    return day;
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[Number(match[2]) - 1];
  if (!month) {
    return day;
  }
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

export function displayHostPath(productUrl: string): string {
  try {
    const url = new URL(productUrl);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.host}${path}`;
  } catch {
    return productUrl;
  }
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return iso;
  }
  const deltaSec = Math.round((now.getTime() - then) / 1000);
  if (deltaSec < 45) return "just now";
  if (deltaSec < 90) return "1 minute ago";
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} minutes ago`;
  if (deltaSec < 5400) return "1 hour ago";
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)} hours ago`;
  if (deltaSec < 172800) return "yesterday";
  return `${Math.round(deltaSec / 86400)} days ago`;
}
