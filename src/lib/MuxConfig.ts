export type MuxConfig = {
    /**
     * Mux is a simple multiplexer that buffers multiple operations and only allows the last one to be emitted.
     * allows discrimination of operations by key.
     * It is useful for situations where you want to ensure that only the last operation is executed.
     */
    /**
     * the amount of time to wait and buffer data
     */
    bufferTime: number
    /**
     * the amount of time to wait before retrying
     */
    retryCoolDown: number
    /**
     * the number of times to retry before giving up
     */
    maxRetries: number
}
