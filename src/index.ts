import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Workflows application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Workflow in action
 * - Run `npm run deploy` to publish your application
 *
 * Learn more at https://developers.cloudflare.com/workflows
 */

// User-defined params passed to your Workflow
type Params = {
  email: string;
  metadata: Record<string, string>;
};

export class PopulatePriceHistory extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // Can access bindings on `this.env`
    // Can access params on `event.payload`

    const asset = await step.do("get tickers to populate", async () => {
      // Fetch a list of tickers from $SOME_SERVICE - kv store?

      const techTickers = [
        "GOOGL",
        "AAPL",
        "MSFT",
        "AMZN",
        "TSLA",
        "META",
        "NVDA",
      ];

      return {
        inputParams: event,
        tickers: techTickers,
      };
    });

    // You can optionally have a Workflow wait for additional data,
    // human approval or an external webhook or HTTP request, before progressing.
    // You can submit data via HTTP POST to /accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}/events/{eventName}
    const waitForApproval = await step.waitForEvent("request-approval", {
      type: "approval", // define an optional key to switch on
      timeout: "1 minute", // keep it short for the example!
    });

    const apiResponse = await step.do("fetch the asset price", async () => {
      if (asset.tickers.length === 0) {
        throw new Error("No tickers to process");
      }
      const url = `${this.env.ALPHA_VANTAGE_BASE_URL}/query?function=TIME_SERIES_DAILY&symbol=${asset.tickers[0]}&apikey=${this.env.ALPHA_VANTAGE_ACCESS_KEY}`;
      let resp = await fetch(url);
      return await resp.json<any>();
    });

    // await step.sleep("wait on something", "1 minute");

    await step.do(
      "map over assets and store price history",
      // Define a retry strategy
      {
        retries: {
          limit: 5,
          delay: "5 second",
          backoff: "exponential",
        },
        timeout: "15 minutes",
      },
      async () => {
        // Do stuff here, with access to the state from our previous steps
        if (!apiResponse) {
          throw new Error("API call to $STORAGE_SYSTEM failed");
        }
        console.log("API response:", apiResponse);
      }
    );
  }
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let url = new URL(req.url);

    if (url.pathname.startsWith("/favicon")) {
      return Response.json({}, { status: 404 });
    }

    // Get the status of an existing instance, if provided
    // GET /?instanceId=<id here>
    let id = url.searchParams.get("instanceId");
    if (id) {
      let instance = await env.POPULATE_PRICE_HISTORY.get(id);
      return Response.json({
        status: await instance.status(),
      });
    }

    // Spawn a new instance and return the ID and status
    let instance = await env.POPULATE_PRICE_HISTORY.create();
    // You can also set the ID to match an ID in your own system
    // and pass an optional payload to the Workflow
    // let instance = await env.MY_WORKFLOW.create({
    // 	id: 'id-from-your-system',
    // 	params: { payload: 'to send' },
    // });
    return Response.json({
      id: instance.id,
      details: await instance.status(),
    });
  },
};
