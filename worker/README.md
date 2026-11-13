# Letterboxd RSS Worker

This Worker proxies the public Letterboxd RSS feed and caches successful XML
responses at the Cloudflare edge for 10 minutes. It allows browser requests
from `https://rhlmraj.github.io` and `http://localhost:5173`.

## Deploy in the Cloudflare dashboard

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and open
   **Workers & Pages**.
2. Select **Create application** → **Create Worker**.
3. Give the Worker a name, then select **Deploy** to create it.
4. Open the deployed Worker and select **Edit code**.
5. Replace the editor contents with all of `worker/index.js`.
6. Select **Deploy** to publish the code.

The Worker URL is shown in its dashboard overview. Send a `GET` request to that
URL to receive the RSS XML. The Worker handles CORS preflight requests for `GET`;
other request methods are rejected.
