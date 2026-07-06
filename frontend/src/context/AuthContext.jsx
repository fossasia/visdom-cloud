/* Copyright 2017-present, The Visdom Authors */
import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

// Create axios instance with pre-configured API base
export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // Send HTTP cookies (refresh_token)
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Configure request interceptor to append authorization header
  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use(
      (config) => {
        if (accessToken) {
          config.headers['Authorization'] = `Bearer ${accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
    };
  }, [accessToken]);

  // Configure response interceptor to handle token refresh automatically
  useEffect(() => {
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        // If unauthorized and has not retried yet
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            // Request a new access token using the HTTP-only refresh cookie
            const refreshResponse = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
            const newAccessToken = refreshResponse.data.access_token;
            
            setAccessToken(newAccessToken);
            
            // Retry the original request with the new authorization header
            originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
            return api(originalRequest);
          } catch (refreshError) {
            // If refresh fails, log the user out
            setAccessToken(null);
            setUser(null);
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  // Try to load user session on app mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Attempt to call refresh to see if user has a valid refresh cookie
        const refreshResponse = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
        const initialToken = refreshResponse.data.access_token;
        setAccessToken(initialToken);
        
        // Fetch user profiles
        const userResponse = await axios.get('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${initialToken}` }
        });
        setUser(userResponse.data);
      } catch (e) {
        // No active session
        setUser(null);
        setAccessToken(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (email, password) => {
    // OAuth2PasswordRequestForm expects username (email) and password as form data
    const params = new URLSearchParams();
    params.append('username', email);
    params.append('password', password);

    const loginResponse = await axios.post('/api/v1/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      withCredentials: true,
    });

    const token = loginResponse.data.access_token;
    setAccessToken(token);

    // Fetch user details
    const userResponse = await axios.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    setUser(userResponse.data);
    return userResponse.data;
  };

  const register = async (email, password) => {
    const response = await axios.post('/api/v1/auth/register', { email, password });
    return response.data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      console.error('Logout error', e);
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
