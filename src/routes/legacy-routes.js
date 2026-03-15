import {
  buildUpstreamResponseError,
  requireNonEmptyString,
  requireObject,
} from "../http-helpers.js";

export function registerLegacyRoutes(app, { getClient, sendError }) {
  app.get("/v1/account/profile", async (req, res) => {
    try {
      const client = getClient(req);
      const data = await client.getProfileAndFeatures();
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/v1/upload/issue-token", async (req, res) => {
    try {
      const filename = requireNonEmptyString(req.query.filename, "filename");

      const client = getClient(req);
      const data = await client.issueUploadToken(filename);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/v1/upload/verify", async (req, res) => {
    try {
      const body = req.body || {};
      const token = requireNonEmptyString(body.token, "token");
      const { type = "image" } = body;

      const client = getClient(req);
      const data = await client.verifyUploadToken(token, type);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/v1/tasks/submit", async (req, res) => {
    try {
      const body = req.body || {};
      const { poll = false, poll_interval_ms, poll_timeout_ms } = body;
      const task = requireObject(body.task, "task");

      const client = getClient(req);
      const submitted = await client.submitTask(task);

      if (!poll) {
        return res.json({ ok: true, data: submitted });
      }

      const taskId = submitted?.task?.id || submitted?.taskId;
      if (!taskId) {
        throw buildUpstreamResponseError(
          "Task submitted but task id was missing in response",
          { response: submitted }
        );
      }

      const finalState = await client.pollTask(taskId, {
        intervalMs: Number(poll_interval_ms || 5000),
        timeoutMs: Number(poll_timeout_ms || 300000),
      });

      res.json({
        ok: true,
        data: {
          submitted,
          final: finalState,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/v1/tasks/:taskId", async (req, res) => {
    try {
      const client = getClient(req);
      const data = await client.getTaskStatus(req.params.taskId);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/v1/tasks/:taskId/poll", async (req, res) => {
    try {
      const client = getClient(req);
      const data = await client.pollTask(req.params.taskId, {
        intervalMs: Number(req.query.interval_ms || 5000),
        timeoutMs: Number(req.query.timeout_ms || 300000),
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });
}
