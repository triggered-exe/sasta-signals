// Custom Error class
class AppError extends Error {
  constructor(message = 'An error occurred', statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request') {
    return new AppError(message, 400);
  }

  static notFound(message = 'Not Found') {
    return new AppError(message, 404);
  }

  static internalError(message = 'Internal Server Error') {
    return new AppError(message, 500);
  }

  static serviceUnavailable(message) {
    return new AppError(message, 503);
  }
}

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  let error;
  if (err instanceof AppError) {
    error = err;
  } else {
    const statusCode = err.statusCode || 500;
    error = new AppError(err.message || 'Something went wrong', statusCode);
  }

  console.error(error.stack);

  res.status(error.statusCode).json({
    status: error.status,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
};

// Use ES modules export syntax
export { AppError, errorHandler };
