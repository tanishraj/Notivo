export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/admin/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      result.error ??
        result.message ??
        result.reason ??
        result.scan?.error ??
        result.emails?.error ??
        "The request failed. Please try again.",
      response.status,
    );
  return result as T;
}
