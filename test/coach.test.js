const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const handler = require('../api/coach');

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalConsole = {
  error: console.error,
  info: console.info
};

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  console.error = () => {};
  console.info = () => {};
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }
  console.error = originalConsole.error;
  console.info = originalConsole.info;
});

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function callHandler(body, method = 'POST') {
  const res = createResponse();
  await handler({ method, body }, res);
  return res;
}

function successfulProviderResponse(model = 'provider/test-model') {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model,
        choices: [{ message: { content: 'Eine hilfreiche Antwort.' } }]
      };
    }
  };
}

test('default coach calls OpenRouter without the old plugin payload', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return successfulProviderResponse();
  };

  const res = await callHandler({ question: 'Wie verbessere ich den Takt?' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'openrouter');
  assert.equal(res.body.model, 'provider/test-model');
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'openrouter/auto');
  assert.equal(payload.max_tokens, 2048);
  assert.equal(Object.hasOwn(payload, 'plugins'), false);
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('professional role uses OpenRouter with its professional system prompt', async () => {
  let payload;
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return successfulProviderResponse();
  };

  const res = await callHandler({
    question: 'Bewerte meine Anlehnung.',
    role: 'professional'
  });

  assert.equal(res.statusCode, 200);
  assert.match(payload.messages[0].content, /Expertenfachkraft/);
});

test('missing OpenRouter key returns a configuration error without a provider call', async () => {
  delete process.env.OPENROUTER_API_KEY;
  global.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  const res = await callHandler({ question: 'Eine Frage' });

  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /OpenRouter/);
});

test('provider failures return a gateway error', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 503,
    async json() {
      return { error: { message: 'temporarily unavailable' } };
    }
  });

  const res = await callHandler({ question: 'Eine Frage' });

  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /OpenRouter/);
});

test('non-object request bodies are rejected before contacting the provider', async () => {
  global.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  const res = await callHandler([]);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Anfrageformat/);
});
