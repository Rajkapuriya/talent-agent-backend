import { EventEmitter } from 'events';

/**
 * Singleton EventEmitter used to broadcast SSE events
 * from the async pipeline runner to the SSE route handler.
 *
 * Key pattern: run_<timestamp>
 * Each pipeline run emits events on its own key.
 * The SSE route handler subscribes to that key and
 * forwards events to the client via res.write().
 *
 * Usage:
 *   // In pipeline runner:
 *   pipelineEmitter.emit(runId, { stage: 'parsed', ... });
 *
 *   // In SSE route:
 *   pipelineEmitter.on(runId, (data) => { res.write(...) });
 */
const pipelineEmitter = new EventEmitter();

// Increase max listeners to avoid Node.js warnings
// (one listener per active SSE connection)
pipelineEmitter.setMaxListeners(100);

export default pipelineEmitter;