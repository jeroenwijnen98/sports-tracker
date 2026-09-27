/**
 * What `tokenCheck` puts on the request for the routes behind it.
 */
import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** The stored Polar access token; set by `tokenCheck`. */
    accessToken?: string;
    /** Polar's `x_user_id` from the token; set by `tokenCheck`. */
    polarUserId?: number;
  }
}
