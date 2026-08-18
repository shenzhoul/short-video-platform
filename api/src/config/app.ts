/**
 * Application configuration settings
 * Contains basic server and URL configuration
 */
export default {
  /** HTTP server port - defaults to 8080 if not specified in environment */
  port: process.env.HTTP_PORT || 8080,
  /** Base URL for the application - used for generating absolute URLs */
  baseUrl: process.env.BASE_URL || 'http://localhost:8080'
};
