import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// Exercise the real modules without sending analytics or loading browser code.
function runWithMocks(modules, script) {
  const hook = `
    const modules = ${JSON.stringify(modules)};
    export async function resolve(specifier, context, next) {
      if (Object.hasOwn(modules, specifier)) {
        return { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true };
      }
      return next(specifier, context);
    }`
  const register = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hook)}));`
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(register)}`,
    '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'test-token';
      process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://example.invalid';
      ${script}
    `,
  ], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('AI telemetry excludes prompt and response content while preserving usage and flushing', () => {
  runWithMocks({
    'posthog-node': `export class PostHog {
      constructor(key, options) { globalThis.options = options }
      capture(event) { globalThis.captured = event }
      async flush() { globalThis.flushed = true }
    }`,
  }, `
    const { captureAiGeneration } = await import('./lib/server/posthogAi.js');
    await captureAiGeneration({
      distinctId: 'user-id', traceId: 'trace-id', spanId: 'span-id', model: 'model',
      messages: [{ role: 'user', content: 'PRIVATE PROMPT' }], content: 'PRIVATE RESPONSE',
      usage: { prompt_tokens: 12, completion_tokens: 34 }, latencyMs: 250, httpStatus: 200,
    });
    assert.equal(globalThis.options.privacyMode, true);
    assert.equal(globalThis.captured.distinctId, 'user-id');
    assert.equal(globalThis.captured.properties.$ai_input_tokens, 12);
    assert.equal(globalThis.captured.properties.$ai_output_tokens, 34);
    assert.equal(globalThis.captured.properties.$ai_latency, 0.25);
    assert.equal(globalThis.flushed, true);
    assert.ok(!('$ai_input' in globalThis.captured.properties));
    assert.ok(!('$ai_output_choices' in globalThis.captured.properties));
    assert.ok(!JSON.stringify(globalThis.captured).includes('PRIVATE'));
  `)
})

test('Vercel failures cannot suppress PostHog events and reporting failures cannot escape', () => {
  runWithMocks({
    '@vercel/analytics': `export function track() { throw new Error('Vercel unavailable') }`,
    'posthog-js': `export default {
      capture(name, properties) { globalThis.captured = { name, properties } },
      captureException() { throw new Error('PostHog unavailable') },
    }`,
  }, `
    const { trackProductEvent, captureProductException } = await import('./lib/productAnalytics.js');
    assert.doesNotThrow(() => trackProductEvent('city_selected', { city: 'helsinki' }));
    assert.deepEqual(globalThis.captured, { name: 'city_selected', properties: { city: 'helsinki' } });
    assert.doesNotThrow(() => captureProductException(new Error('original error')));
  `)
})
