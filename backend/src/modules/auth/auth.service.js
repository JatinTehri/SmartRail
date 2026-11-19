/**
 * auth.service.js — Business Logic Layer for Authentication
 *
 * Implements business rules for registration, password hashing, and duplicate checks.
 */

'use strict';

const bcrypt = require('bcryptjs');
const authRepository = require('./auth.repository');
const { generateToken } = require('../../utils/token');
const AppError = require('../../errors/AppError');

const SALT_ROUNDS = 10;

/**
 * Registers a new user.
 *
 * Business Rules:
 *   - Checks for duplicate email and throws 409 Conflict if already registered.
 *   - Hashes password using bcryptjs with 10 salt rounds.
 *   - Inserts record into database via repository.
 *   - Catches PostgreSQL unique violation (code 23505) for concurrent race conditions.
 *   - Strictly sanitizes the returned user object (omits password_hash and internal timestamps).
 *
 * @param {object} params
 * @param {string} params.name - Full name
 * @param {string} params.email - Sanitized email address
 * @param {string} params.password - Plain text password
 * @param {string|null} [params.phone] - Optional phone number
 * @returns {Promise<object>} Sanitized user object: { id, name, email, role }
 */
async function registerUser({ name, email, password, phone = null }) {
  // 1. Application-level duplicate email check
  const existingUser = await authRepository.findByEmail(email);
  if (existingUser) {
    throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
  }

  // 2. Hash password with bcryptjs (10 salt rounds)
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 3. Persist user in database
  let createdUser;
  try {
    createdUser = await authRepository.createUser({
      name,
      email,
      phone,
      passwordHash,
      role: 'USER', // Always defaults to USER for public registration
    });
  } catch (err) {
    // 4. Handle race conditions where two identical requests arrive simultaneously
    // PostgreSQL error code '23505' indicates a unique_violation
    if (err.code === '23505') {
      throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
    }
    throw err;
  }

  // 5. Return sanitized user object matching docs/API.md
  return {
    id: createdUser.id,
    name: createdUser.name,
    email: createdUser.email,
    role: createdUser.role,
  };
}

/**
 * Authenticates an existing user with email and password.
 *
 * Business Rules:
 *   - Look up user by email via repository.
 *   - If not found, throw 401 Unauthorized ('Invalid email or password').
 *   - Compare submitted password against stored hash using bcrypt.compare().
 *   - If password does not match, throw 401 Unauthorized ('Invalid email or password').
 *   - Generate signed JWT token using user.id.
 *   - Return sanitized user object and JWT token.
 *   - Uniform 401 response prevents user enumeration attacks.
 *
 * @param {object} params
 * @param {string} params.email - Cleaned email address
 * @param {string} params.password - Candidate password
 * @returns {Promise<{ user: object, token: string }>}
 */
async function loginUser({ email, password }) {
  // 1. Look up user by email
  const user = await authRepository.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // 2. Verify password with constant-time bcrypt comparison
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // 3. Generate signed JWT token
  const token = generateToken(user.id);

  // 4. Return sanitized user and token
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  };
}

/**
 * Retrieves the current authenticated user's profile by ID.
 *
 * Business Rules:
 *   - Fetch user from PostgreSQL by primary key ID.
 *   - If user does not exist (e.g. deleted account with an unexpired token), throw 401 Unauthorized.
 *   - Return strictly sanitized user object: { id, name, email, role }.
 *   - Never return password_hash or internal secrets.
 *
 * @param {number|string} userId - The user ID from decoded JWT sub claim
 * @returns {Promise<object>} Sanitized user profile
 */
async function getCurrentUser(userId) {
  const user = await authRepository.findById(userId);
  if (!user) {
    throw new AppError('User not found or account deactivated', 401, 'UNAUTHORIZED');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
};
