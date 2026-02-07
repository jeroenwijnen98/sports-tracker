import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3000,
  polar: {
    clientId: process.env.POLAR_CLIENT_ID,
    clientSecret: process.env.POLAR_CLIENT_SECRET,
    authUrl: 'https://flow.polar.com/oauth2/authorization',
    tokenUrl: 'https://polarremote.com/v2/oauth2/token',
    apiBase: 'https://www.polaraccesslink.com/v3',
    redirectUri: `http://localhost:${process.env.PORT || 3000}/auth/callback`,
  },
};
