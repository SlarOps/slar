/**
 * Credentials Service
 * Handles interactions with the Vault-based credential management API
 */

import { getConfigSync } from '@/lib/config';

class CredentialsService {
    constructor() {
        // Config might not be loaded yet when class is instantiated
        // Access it via getter or inside methods
        this.token = null;
    }

    setToken(token) {
        this.token = token;
    }

    get baseUrl() {
        return getConfigSync().aiApiUrl;
    }

    get headers() {
        return {
            'Content-Type': 'application/json',
            ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        };
    }

    /**
     * Check Vault status
     * @returns {Promise<{success: boolean, vault_available: boolean, vault_enabled: boolean}>}
     */
    async getVaultStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/credentials/status`, {
                headers: this.headers
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch vault status:', error);
            return { success: false, vault_available: false, error: error.message };
        }
    }

    /**
     * Get available credential types and metadata
     * @returns {Promise<{success: boolean, types: Array}>}
     */
    async getCredentialTypes() {
        try {
            const response = await fetch(`${this.baseUrl}/api/credentials/types`, {
                headers: this.headers
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch credential types:', error);
            return { success: false, types: [], error: error.message };
        }
    }

    /**
     * List credentials
     * @param {string} type - Optional credential type to filter by
     * @returns {Promise<{success: boolean, credentials: Array}>}
     */
    async listCredentials(type = null) {
        try {
            let url = `${this.baseUrl}/api/credentials`;
            if (type) {
                url += `?credential_type=${encodeURIComponent(type)}`;
            }

            const response = await fetch(url, {
                headers: this.headers
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to list credentials:', error);
            return { success: false, credentials: [], error: error.message };
        }
    }

    /**
     * Store a new credential
     * @param {Object} credential - { credential_type, credential_name, data, description, tags }
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async storeCredential(credential) {
        try {
            const response = await fetch(`${this.baseUrl}/api/credentials`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(credential)
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to store credential:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update credential metadata (export settings)
     * @param {string} type - Credential type
     * @param {string} name - Credential name
     * @param {Object} updates - { env_var_name?, export_to_agent? }
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async updateCredential(type, name, updates) {
        try {
            const response = await fetch(`${this.baseUrl}/api/credentials/${type}/${name}`, {
                method: 'PATCH',
                headers: this.headers,
                body: JSON.stringify(updates)
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to update credential:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a credential
     * @param {string} type - Credential type
     * @param {string} name - Credential name
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async deleteCredential(type, name) {
        try {
            const response = await fetch(`${this.baseUrl}/api/credentials/${type}/${name}`, {
                method: 'DELETE',
                headers: this.headers
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to delete credential:', error);
            return { success: false, error: error.message };
        }
    }
}

export const credentialsService = new CredentialsService();
