/** Compile-time flag for the serverless, read-only example build. */
export const IS_STATIC_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true'
