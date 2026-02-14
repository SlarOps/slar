/**
 * Unit tests for SkillsTab component (Option 1B - Separate Skill Tab)
 *
 * Tests cover:
 * 1. Rendering skill repositories list
 * 2. Adding new skill repository
 * 3. Browsing and searching skills
 * 4. Installing individual skills
 * 5. Uninstalling skills
 * 6. Updating repositories
 * 7. Error handling and edge cases
 *
 * Note: This requires Jest + React Testing Library to be set up.
 * To run: npm test SkillsTab.test.js
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SkillsTab from '../SkillsTab';
import apiClient from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';

// Mock dependencies
jest.mock('../../../lib/api');
jest.mock('../../../contexts/AuthContext');

// Test data
const mockSession = {
  user: { id: 'user-123' },
  access_token: 'test-token'
};

const mockSkillRepositories = [
  {
    id: 'repo-1',
    name: 'openskills',
    repository_url: 'https://github.com/numman-ali/openskills',
    branch: 'main',
    skills: [
      {
        name: 'vnstock-analyzer',
        description: 'Analyze Vietnamese stocks',
        path: 'vnstock-analyzer/SKILL.md'
      },
      {
        name: 'crypto-tracker',
        description: 'Track cryptocurrency prices',
        path: 'crypto-tracker/SKILL.md'
      }
    ],
    git_commit_sha: 'abc123',
    status: 'active'
  }
];

const mockInstalledSkills = [
  {
    id: 'skill-install-1',
    skill_name: 'vnstock-analyzer',
    repository_name: 'openskills',
    skill_path: 'vnstock-analyzer/SKILL.md',
    status: 'active'
  }
];

describe('SkillsTab Component', () => {

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Mock useAuth hook
    useAuth.mockReturnValue({ session: mockSession });

    // Mock API responses (default success)
    apiClient.getSkillRepositories.mockResolvedValue({
      success: true,
      repositories: mockSkillRepositories
    });

    apiClient.getInstalledSkills.mockResolvedValue({
      success: true,
      skills: mockInstalledSkills
    });
  });

  // ============================================================
  // Rendering Tests
  // ============================================================

  describe('Rendering', () => {

    test('should render skills tab with header', async () => {
      render(<SkillsTab />);

      expect(screen.getByText(/skill repositories/i)).toBeInTheDocument();
      expect(screen.getByText(/browse and install skills/i)).toBeInTheDocument();
    });

    test('should render search input', async () => {
      render(<SkillsTab />);

      const searchInput = screen.getByPlaceholderText(/search skills/i);
      expect(searchInput).toBeInTheDocument();
    });

    test('should render "Add Repository" button', async () => {
      render(<SkillsTab />);

      const addButton = screen.getByRole('button', { name: /add repository/i });
      expect(addButton).toBeInTheDocument();
    });

    test('should display loading state initially', () => {
      render(<SkillsTab />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    test('should display skill repositories after loading', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText('openskills')).toBeInTheDocument();
      });
    });

    test('should display empty state when no repositories', async () => {
      apiClient.getSkillRepositories.mockResolvedValue({
        success: true,
        repositories: []
      });

      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText(/no skill repositories/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================
  // Add Repository Tests
  // ============================================================

  describe('Add Repository', () => {

    test('should show add form when "Add Repository" clicked', () => {
      render(<SkillsTab />);

      const addButton = screen.getByRole('button', { name: /add repository/i });
      fireEvent.click(addButton);

      expect(screen.getByPlaceholderText(/github url/i)).toBeInTheDocument();
    });

    test('should validate GitHub URL format', async () => {
      render(<SkillsTab />);

      // Open form
      fireEvent.click(screen.getByRole('button', { name: /add repository/i }));

      // Enter invalid URL
      const urlInput = screen.getByPlaceholderText(/github url/i);
      fireEvent.change(urlInput, { target: { value: 'invalid-url' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid github url/i)).toBeInTheDocument();
      });
    });

    test('should call API to add repository', async () => {
      apiClient.addSkillRepository.mockResolvedValue({
        success: true,
        repository: mockSkillRepositories[0]
      });

      render(<SkillsTab />);

      // Open form
      fireEvent.click(screen.getByRole('button', { name: /add repository/i }));

      // Enter valid URL
      const urlInput = screen.getByPlaceholderText(/github url/i);
      fireEvent.change(urlInput, {
        target: { value: 'https://github.com/numman-ali/openskills' }
      });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(apiClient.addSkillRepository).toHaveBeenCalledWith({
          repository_url: 'https://github.com/numman-ali/openskills',
          branch: 'main'
        });
      });
    });

    test('should show success message after adding repository', async () => {
      apiClient.addSkillRepository.mockResolvedValue({
        success: true,
        repository: mockSkillRepositories[0]
      });

      render(<SkillsTab />);

      // Open form and submit
      fireEvent.click(screen.getByRole('button', { name: /add repository/i }));
      const urlInput = screen.getByPlaceholderText(/github url/i);
      fireEvent.change(urlInput, {
        target: { value: 'https://github.com/numman-ali/openskills' }
      });
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(screen.getByText(/repository added/i)).toBeInTheDocument();
      });
    });

    test('should show error if repository already exists', async () => {
      apiClient.addSkillRepository.mockResolvedValue({
        success: false,
        error: 'Repository already exists'
      });

      render(<SkillsTab />);

      // Open form and submit
      fireEvent.click(screen.getByRole('button', { name: /add repository/i }));
      const urlInput = screen.getByPlaceholderText(/github url/i);
      fireEvent.change(urlInput, {
        target: { value: 'https://github.com/numman-ali/openskills' }
      });
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(screen.getByText(/repository already exists/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================
  // Browse Skills Tests
  // ============================================================

  describe('Browse Skills', () => {

    test('should display skills from repository', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText('vnstock-analyzer')).toBeInTheDocument();
        expect(screen.getByText('crypto-tracker')).toBeInTheDocument();
      });
    });

    test('should display skill descriptions', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText(/analyze vietnamese stocks/i)).toBeInTheDocument();
      });
    });

    test('should expand/collapse repository skills', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        const repoHeader = screen.getByText('openskills');
        expect(repoHeader).toBeInTheDocument();
      });

      // Click to expand
      const expandButton = screen.getByRole('button', { name: /expand/i });
      fireEvent.click(expandButton);

      // Skills should be visible
      expect(screen.getByText('vnstock-analyzer')).toBeVisible();
    });

    test('should filter skills by search term', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText('vnstock-analyzer')).toBeInTheDocument();
      });

      // Search for "crypto"
      const searchInput = screen.getByPlaceholderText(/search skills/i);
      fireEvent.change(searchInput, { target: { value: 'crypto' } });

      // Only crypto-tracker should be visible
      expect(screen.getByText('crypto-tracker')).toBeInTheDocument();
      expect(screen.queryByText('vnstock-analyzer')).not.toBeInTheDocument();
    });
  });

  // ============================================================
  // Install Skill Tests
  // ============================================================

  describe('Install Skill', () => {

    test('should show "Install" button for non-installed skills', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        const installButtons = screen.getAllByRole('button', { name: /^install$/i });
        expect(installButtons.length).toBeGreaterThan(0);
      });
    });

    test('should show "Installed" badge for installed skills', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText(/installed/i)).toBeInTheDocument();
      });
    });

    test('should call API to install skill', async () => {
      apiClient.installSkill.mockResolvedValue({
        success: true,
        skill: mockInstalledSkills[0]
      });

      render(<SkillsTab />);

      await waitFor(() => {
        const installButton = screen.getAllByRole('button', { name: /^install$/i })[0];
        fireEvent.click(installButton);
      });

      await waitFor(() => {
        expect(apiClient.installSkill).toHaveBeenCalledWith(
          expect.objectContaining({
            skill_name: expect.any(String),
            repository_name: 'openskills'
          })
        );
      });
    });

    test('should show success message after installing skill', async () => {
      apiClient.installSkill.mockResolvedValue({
        success: true,
        skill: mockInstalledSkills[0]
      });

      render(<SkillsTab />);

      await waitFor(() => {
        const installButton = screen.getAllByRole('button', { name: /^install$/i })[0];
        fireEvent.click(installButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/skill installed/i)).toBeInTheDocument();
      });
    });

    test('should handle installation errors', async () => {
      apiClient.installSkill.mockResolvedValue({
        success: false,
        error: 'Installation failed'
      });

      render(<SkillsTab />);

      await waitFor(() => {
        const installButton = screen.getAllByRole('button', { name: /^install$/i })[0];
        fireEvent.click(installButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/installation failed/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================
  // Uninstall Skill Tests
  // ============================================================

  describe('Uninstall Skill', () => {

    test('should show "Uninstall" button for installed skills', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /uninstall/i })).toBeInTheDocument();
      });
    });

    test('should show confirmation dialog before uninstalling', async () => {
      window.confirm = jest.fn(() => true);

      render(<SkillsTab />);

      await waitFor(() => {
        const uninstallButton = screen.getByRole('button', { name: /uninstall/i });
        fireEvent.click(uninstallButton);
      });

      expect(window.confirm).toHaveBeenCalled();
    });

    test('should call API to uninstall skill', async () => {
      window.confirm = jest.fn(() => true);
      apiClient.uninstallSkill.mockResolvedValue({ success: true });

      render(<SkillsTab />);

      await waitFor(() => {
        const uninstallButton = screen.getByRole('button', { name: /uninstall/i });
        fireEvent.click(uninstallButton);
      });

      await waitFor(() => {
        expect(apiClient.uninstallSkill).toHaveBeenCalled();
      });
    });
  });

  // ============================================================
  // Update Repository Tests
  // ============================================================

  describe('Update Repository', () => {

    test('should show update button for each repository', async () => {
      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
      });
    });

    test('should call API to update repository', async () => {
      apiClient.updateSkillRepository.mockResolvedValue({
        success: true,
        had_changes: true
      });

      render(<SkillsTab />);

      await waitFor(() => {
        const updateButton = screen.getByRole('button', { name: /update/i });
        fireEvent.click(updateButton);
      });

      await waitFor(() => {
        expect(apiClient.updateSkillRepository).toHaveBeenCalled();
      });
    });

    test('should show loading state while updating', async () => {
      apiClient.updateSkillRepository.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<SkillsTab />);

      await waitFor(() => {
        const updateButton = screen.getByRole('button', { name: /update/i });
        fireEvent.click(updateButton);
      });

      expect(screen.getByText(/updating/i)).toBeInTheDocument();
    });
  });

  // ============================================================
  // Error Handling Tests
  // ============================================================

  describe('Error Handling', () => {

    test('should show error message when API fails', async () => {
      apiClient.getSkillRepositories.mockRejectedValue(
        new Error('Network error')
      );

      render(<SkillsTab />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      });
    });

    test('should require authentication', () => {
      useAuth.mockReturnValue({ session: null });

      render(<SkillsTab />);

      expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    });
  });
});
