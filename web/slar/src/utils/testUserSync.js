// Test utility for User Auto-Sync functionality
// This file helps test the auto-sync mechanism between Supabase and backend

import { auth } from '../lib/supabase';
import { apiClient } from '../lib/api';

/**
 * Test user auto-sync functionality
 * This function simulates the complete flow from signup to API usage
 */
export async function testUserAutoSync() {
  console.log('🧪 Testing User Auto-Sync Functionality...');
  
  try {
    // Step 1: Get current session
    const { session } = await auth.getSession();
    if (!session?.access_token) {
      console.error('❌ No valid session found. Please login first.');
      return false;
    }
    
    console.log('✅ Valid session found:', {
      user_id: session.user.id,
      email: session.user.email,
      user_metadata: session.user.user_metadata
    });

    // Step 2: Set token and make API call to trigger auto-sync
    apiClient.setToken(session.access_token);
    
    console.log('🔄 Making API call to trigger auto-sync...');
    
    // This call will trigger the auto-sync mechanism
    const users = await apiClient.getUsers();
    console.log('✅ API call successful. Users found:', users.length);
    
    // Step 3: Verify current user exists in backend
    const currentUserId = `oauth-google-${session.user.id}`; // Adjust based on provider
    console.log('🔍 Looking for user in backend:', currentUserId);
    
    try {
      const currentUser = await apiClient.getUser(currentUserId);
      console.log('✅ User successfully synced to backend:', currentUser);
      
      // Step 4: Test group functionality (requires synced user)
      console.log('🔄 Testing group creation with synced user...');
      
      const testGroup = await apiClient.createGroup({
        name: `Test Group ${Date.now()}`,
        description: 'Group created to test user auto-sync',
        type: 'escalation',
        escalation_timeout: 300,
        escalation_method: 'parallel'
      });
      
      console.log('✅ Group created successfully:', testGroup.group);
      
      // Step 5: Test adding user to group
      console.log('🔄 Testing adding synced user to group...');
      
      const member = await apiClient.addGroupMember(testGroup.group.id, {
        user_id: currentUserId,
        role: 'member',
        escalation_order: 1,
        notification_preferences: {
          fcm: true,
          email: true,
          sms: false
        }
      });
      
      console.log('✅ User added to group successfully:', member.member);
      
      // Cleanup: Delete test group
      await apiClient.deleteGroup(testGroup.group.id);
      console.log('🧹 Test group cleaned up');
      
      console.log('🎉 All tests passed! User auto-sync is working correctly.');
      return true;
      
    } catch (userError) {
      console.error('❌ User not found in backend:', userError.message);
      console.log('📋 User should be auto-created on first API call');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test user signup and immediate sync
 */
export async function testSignupAndSync(email, password, metadata = {}) {
  console.log('🧪 Testing Signup + Auto-Sync...');
  
  try {
    // Step 1: Sign up new user
    console.log('🔄 Creating new user account...');
    
    const { data, error } = await auth.signUp(email, password, metadata);
    
    if (error) {
      console.error('❌ Signup failed:', error.message);
      return false;
    }
    
    console.log('✅ User created in Supabase:', data.user.id);
    
    // Step 2: Wait for email confirmation (in real app)
    console.log('📧 Check email for confirmation link...');
    
    // For testing with confirmed users:
    if (data.session?.access_token) {
      console.log('🔄 Testing immediate sync...');
      
      // Set token and make API call
      apiClient.setToken(data.session.access_token);
      
      // This should trigger auto-sync
      await apiClient.getUsers();
      
      console.log('✅ Auto-sync triggered successfully');
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Signup test failed:', error.message);
    return false;
  }
}

/**
 * Check if current user is synced to backend
 */
export async function checkUserSyncStatus() {
  try {
    const { session } = await auth.getSession();
    if (!session?.access_token) {
      return { synced: false, error: 'No valid session' };
    }
    
    apiClient.setToken(session.access_token);
    
    // Try to get current user from backend
    const userId = `oauth-google-${session.user.id}`; // Adjust based on provider
    
    try {
      const user = await apiClient.getUser(userId);
      return { synced: true, user };
    } catch (error) {
      return { synced: false, error: error.message };
    }
    
  } catch (error) {
    return { synced: false, error: error.message };
  }
}

/**
 * Get user metadata for debugging
 */
export function getUserMetadata() {
  return auth.getSession().then(({ session }) => {
    if (!session?.user) return null;
    
    return {
      id: session.user.id,
      email: session.user.email,
      user_metadata: session.user.user_metadata,
      app_metadata: session.user.app_metadata,
      created_at: session.user.created_at,
      updated_at: session.user.updated_at
    };
  });
}

// Usage examples:
/*

// Test existing user auto-sync
await testUserAutoSync();

// Test new user signup and sync
await testSignupAndSync('test@example.com', 'password123', {
  full_name: 'Test User',
  company: 'Test Company'
});

// Check current user sync status
const status = await checkUserSyncStatus();
console.log('Sync status:', status);

// Get user metadata for debugging
const metadata = await getUserMetadata();
console.log('User metadata:', metadata);

*/
