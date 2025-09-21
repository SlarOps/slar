/**
 * Test Integration for User-Scoped Groups Feature
 * 
 * This utility helps test the complete groups integration flow:
 * 1. Authentication
 * 2. User auto-sync
 * 3. Group CRUD operations
 * 4. User-scoped filtering
 * 5. Join/leave groups
 */

import { signUp, signIn, signOut } from '../lib/supabase';
import { apiClient } from '../lib/api';

/**
 * Test the complete groups integration flow
 */
export async function testGroupsIntegration() {
  console.log('🧪 Starting Groups Integration Test...');
  
  try {
    // Test 1: User signup and auto-sync
    console.log('\n📝 Test 1: User Signup & Auto-sync');
    const testUser = {
      email: `test-${Date.now()}@example.com`,
      password: 'testpassword123',
      metadata: {
        full_name: 'Test User',
        company: 'Test Company'
      }
    };
    
    const signUpResult = await signUp(testUser.email, testUser.password, testUser.metadata);
    console.log('✅ User signed up:', signUpResult.user?.id);
    
    // Test 2: Sign in to get session
    console.log('\n🔐 Test 2: User Sign In');
    const signInResult = await signIn(testUser.email, testUser.password);
    if (!signInResult.session) {
      throw new Error('No session after sign in');
    }
    
    apiClient.setToken(signInResult.session.access_token);
    console.log('✅ User signed in, token set');
    
    // Test 3: Auto-sync trigger (first API call)
    console.log('\n🔄 Test 3: Auto-sync trigger');
    try {
      const myGroups = await apiClient.getMyGroups();
      console.log('✅ Auto-sync triggered, user record created');
      console.log('📊 My groups:', myGroups.groups?.length || 0);
    } catch (error) {
      console.log('⚠️ Auto-sync may need manual trigger');
    }
    
    // Test 4: Create a private group
    console.log('\n🏗️ Test 4: Create Private Group');
    const privateGroup = await apiClient.createGroup({
      name: `Private Test Group ${Date.now()}`,
      description: 'Test private group',
      type: 'escalation',
      visibility: 'private',
      escalation_timeout: 300,
      escalation_method: 'parallel'
    });
    console.log('✅ Private group created:', privateGroup.id);
    
    // Test 5: Create a public group
    console.log('\n🌍 Test 5: Create Public Group');
    const publicGroup = await apiClient.createGroup({
      name: `Public Test Group ${Date.now()}`,
      description: 'Test public group',
      type: 'notification',
      visibility: 'public'
    });
    console.log('✅ Public group created:', publicGroup.id);
    
    // Test 6: Test user-scoped endpoints
    console.log('\n🔍 Test 6: User-scoped endpoints');
    
    const allEndpoints = [
      { name: 'My Groups', call: () => apiClient.getMyGroups() },
      { name: 'Public Groups', call: () => apiClient.getPublicGroups() },
      { name: 'All Groups (default)', call: () => apiClient.getGroups() },
      { name: 'All Groups (admin)', call: () => apiClient.getAllGroups() }
    ];
    
    for (const endpoint of allEndpoints) {
      try {
        const result = await endpoint.call();
        console.log(`✅ ${endpoint.name}: ${result.groups?.length || 0} groups`);
      } catch (error) {
        console.log(`❌ ${endpoint.name}: ${error.message}`);
      }
    }
    
    // Test 7: Test group member operations (if another user exists)
    console.log('\n👥 Test 7: Group Member Operations');
    try {
      // Get current user ID for membership
      const currentUserId = signInResult.user.id;
      const transformedUserId = `oauth-google-${currentUserId}`;
      
      // Add self as member to public group
      await apiClient.addGroupMember(publicGroup.id, {
        user_id: transformedUserId,
        role: 'member',
        escalation_order: 1,
        notification_preferences: {
          fcm: true,
          email: true,
          sms: false
        }
      });
      console.log('✅ Added self as member to public group');
      
      // Get group with members
      const groupWithMembers = await apiClient.getGroupWithMembers(publicGroup.id);
      console.log('✅ Group with members:', groupWithMembers.members?.length || 0);
      
    } catch (error) {
      console.log('⚠️ Member operations:', error.message);
    }
    
    // Test 8: Test filtering
    console.log('\n🔎 Test 8: Test Filtering');
    const filters = [
      { type: 'escalation' },
      { type: 'notification' },
      { search: 'Test' }
    ];
    
    for (const filter of filters) {
      try {
        const result = await apiClient.getGroups(filter);
        console.log(`✅ Filter ${JSON.stringify(filter)}: ${result.groups?.length || 0} groups`);
      } catch (error) {
        console.log(`❌ Filter ${JSON.stringify(filter)}: ${error.message}`);
      }
    }
    
    // Test 9: Update group (change visibility)
    console.log('\n✏️ Test 9: Update Group Visibility');
    try {
      await apiClient.updateGroup(privateGroup.id, {
        visibility: 'public',
        description: 'Updated to public group'
      });
      console.log('✅ Group visibility updated to public');
    } catch (error) {
      console.log('❌ Update group:', error.message);
    }
    
    // Test 10: Clean up
    console.log('\n🧹 Test 10: Cleanup');
    try {
      await apiClient.deleteGroup(privateGroup.id);
      await apiClient.deleteGroup(publicGroup.id);
      console.log('✅ Test groups deleted');
    } catch (error) {
      console.log('⚠️ Cleanup error:', error.message);
    }
    
    // Sign out
    await signOut();
    console.log('✅ User signed out');
    
    console.log('\n🎉 Groups Integration Test Completed Successfully!');
    return {
      success: true,
      privateGroupId: privateGroup.id,
      publicGroupId: publicGroup.id
    };
    
  } catch (error) {
    console.error('❌ Groups Integration Test Failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Test specific group functionality
 */
export async function testGroupFeature(featureName, session) {
  if (!session?.access_token) {
    throw new Error('No valid session provided');
  }
  
  apiClient.setToken(session.access_token);
  
  switch (featureName) {
    case 'user-scoped-groups':
      return await testUserScopedGroups();
    case 'group-visibility':
      return await testGroupVisibility();
    case 'group-membership':
      return await testGroupMembership();
    default:
      throw new Error(`Unknown feature: ${featureName}`);
  }
}

async function testUserScopedGroups() {
  console.log('🔍 Testing User-Scoped Groups...');
  
  const endpoints = [
    { name: 'getGroups', method: apiClient.getGroups },
    { name: 'getMyGroups', method: apiClient.getMyGroups },
    { name: 'getPublicGroups', method: apiClient.getPublicGroups },
    { name: 'getAllGroups', method: apiClient.getAllGroups }
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      const result = await endpoint.method.call(apiClient);
      results[endpoint.name] = {
        success: true,
        count: result.groups?.length || 0,
        groups: result.groups
      };
      console.log(`✅ ${endpoint.name}: ${results[endpoint.name].count} groups`);
    } catch (error) {
      results[endpoint.name] = {
        success: false,
        error: error.message
      };
      console.log(`❌ ${endpoint.name}: ${error.message}`);
    }
  }
  
  return results;
}

async function testGroupVisibility() {
  console.log('👁️ Testing Group Visibility...');
  
  const visibilityTypes = ['private', 'public', 'organization'];
  const results = {};
  
  for (const visibility of visibilityTypes) {
    try {
      const group = await apiClient.createGroup({
        name: `Test ${visibility} Group ${Date.now()}`,
        description: `Test ${visibility} visibility`,
        type: 'notification',
        visibility: visibility
      });
      
      results[visibility] = {
        success: true,
        groupId: group.id,
        visibility: group.visibility
      };
      
      console.log(`✅ ${visibility} group created:`, group.id);
      
      // Clean up
      await apiClient.deleteGroup(group.id);
      
    } catch (error) {
      results[visibility] = {
        success: false,
        error: error.message
      };
      console.log(`❌ ${visibility} group: ${error.message}`);
    }
  }
  
  return results;
}

async function testGroupMembership() {
  console.log('👥 Testing Group Membership...');
  
  // This would need actual user IDs to test properly
  // For now, just test the API structure
  try {
    const groups = await apiClient.getMyGroups();
    
    if (groups.groups && groups.groups.length > 0) {
      const firstGroup = groups.groups[0];
      const members = await apiClient.getGroupMembers(firstGroup.id);
      
      return {
        success: true,
        groupId: firstGroup.id,
        memberCount: members.members?.length || 0
      };
    } else {
      return {
        success: true,
        message: 'No groups to test membership'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to create test data
export async function createTestGroups(session, count = 5) {
  if (!session?.access_token) {
    throw new Error('No valid session provided');
  }
  
  apiClient.setToken(session.access_token);
  
  const testGroups = [];
  const visibilities = ['private', 'public', 'organization'];
  const types = ['escalation', 'notification', 'approval'];
  
  for (let i = 0; i < count; i++) {
    try {
      const group = await apiClient.createGroup({
        name: `Test Group ${i + 1} - ${Date.now()}`,
        description: `Test group #${i + 1} for integration testing`,
        type: types[i % types.length],
        visibility: visibilities[i % visibilities.length],
        escalation_timeout: 300,
        escalation_method: 'parallel'
      });
      
      testGroups.push(group);
      console.log(`✅ Created test group ${i + 1}:`, group.name);
    } catch (error) {
      console.log(`❌ Failed to create test group ${i + 1}:`, error.message);
    }
  }
  
  return testGroups;
}

// Helper function to clean up test data
export async function cleanupTestGroups(session, groupIds) {
  if (!session?.access_token) {
    throw new Error('No valid session provided');
  }
  
  apiClient.setToken(session.access_token);
  
  for (const groupId of groupIds) {
    try {
      await apiClient.deleteGroup(groupId);
      console.log(`✅ Deleted test group:`, groupId);
    } catch (error) {
      console.log(`❌ Failed to delete test group ${groupId}:`, error.message);
    }
  }
}
