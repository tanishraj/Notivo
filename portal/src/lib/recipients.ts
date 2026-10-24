export const MAX_RECIPIENTS = 20;

export function splitRecipients(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\s]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function mergeRecipients(current: string[], input: string): string[] {
  const next = splitRecipients([...current, input].join(","));
  const invalid = next.find(
    (email) =>
      email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email),
  );
  if (invalid)
    throw new Error(`“${invalid.slice(0, 80)}” is not a valid email address.`);
  if (next.length > MAX_RECIPIENTS)
    throw new Error(`You can add up to ${MAX_RECIPIENTS} recipients.`);
  return next;
}

export function initials(value: string): string {
  const words = value
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  return (
    words.length > 1
      ? `${Array.from(words[0]!)[0]}${Array.from(words[words.length - 1]!)[0]}`
      : Array.from(words[0] ?? "?")
          .slice(0, 2)
          .join("")
  ).toUpperCase();
}
