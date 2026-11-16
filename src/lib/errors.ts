/** Error whose message is safe to show to customers. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "BAD_REQUEST",
    public status: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") { super(message, "NOT_FOUND", 404); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") { super(message, "FORBIDDEN", 403); }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") { super(message, "UNAUTHORIZED", 401); }
}
export class InsufficientStockError extends AppError {
  constructor(public productName: string, public available: number) {
    super(available > 0 ? `Only ${available} unit(s) of ${productName} are available.` : `${productName} is out of stock.`, "INSUFFICIENT_STOCK", 409, { available });
  }
}
export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") { super(message, "RATE_LIMITED", 429); }
}
