"use client";

import { useState, useEffect } from "react";
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui';
import { apiClient } from '../../lib/api';

export default function RunbooksPage() {
  const { session } = useAuth();
  const [githubUrl, setGithubUrl] = useState("");
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingStatus, setIndexingStatus] = useState("");
  const [indexedFiles, setIndexedFiles] = useState([]);
  const [documentStats, setDocumentStats] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load existing indexed files on component mount
  useEffect(() => {
    loadIndexedFiles();
  }, []);

  const loadIndexedFiles = async () => {
    try {
      // Load document statistics
      const stats = await apiClient.getRunbookStats();
      setDocumentStats(stats);

      // Load actual indexed documents
      const docsData = await apiClient.listRunbookDocuments();

      // Transform the documents into the format expected by the UI
      const transformedFiles = docsData.documents.map((doc, index) => {
        // Extract title from source_display or metadata
        let name = "Untitled Document";
        if (doc.source_display) {
          // For GitHub files, extract filename without extension
          if (doc.source_display.includes('/')) {
            name = doc.source_display.split('/').pop().replace(/\.(md|txt|rst)$/i, '');
          } else {
            name = doc.source_display.replace(/\.(md|txt|rst)$/i, '');
          }
        } else if (doc.metadata?.path) {
          name = doc.metadata.path.split('/').pop().replace(/\.(md|txt|rst)$/i, '');
        } else if (doc.content_preview) {
          // Try to extract title from first line of content
          const firstLine = doc.content_preview.split('\n')[0];
          if (firstLine.startsWith('#')) {
            name = firstLine.replace(/^#+\s*/, '').trim();
          } else if (firstLine.length > 0 && firstLine.length < 100) {
            name = firstLine.trim();
          }
        }

        return {
          id: doc.id || index,
          name: name,
          source: doc.metadata?.github_url || doc.metadata?.source || 'Unknown source',
          source_display: doc.source_display || 'Unknown file',
          path: doc.metadata?.path || '',
          indexed_at: new Date().toISOString(), // We don't have this info, use current time
          status: "active",
          content_preview: doc.content_preview || '',
          chunk_count: doc.chunk_count || 1,
          total_chunks: doc.chunks?.length || 1
        };
      });

      setIndexedFiles(transformedFiles);
    } catch (err) {
      console.error("Error loading indexed files:", err);
      setError("Failed to load indexed documents. Make sure the AI service is running.");
      setIndexedFiles([]);
    }
  };

  const validateGithubUrl = (url) => {
    const githubPattern = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+\/(blob|tree)\/[\w\-\.\/]+\.(md|txt|rst)$/i;
    const githubRepoPattern = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+\/?$/i;
    
    return githubPattern.test(url) || githubRepoPattern.test(url);
  };

  const handleIndexRunbooks = async (e) => {
    e.preventDefault();
    
    if (!githubUrl.trim()) {
      setError("Please enter a GitHub URL");
      return;
    }

    if (!validateGithubUrl(githubUrl)) {
      setError("Please enter a valid GitHub URL (repository or markdown file)");
      return;
    }

    setIsIndexing(true);
    setError("");
    setSuccess("");
    setIndexingStatus("Connecting to GitHub...");

    try {
      // Call the AI service to index runbooks from GitHub
      const result = await apiClient.indexRunbooksFromGithub(
        githubUrl,
        session?.user?.id || 'anonymous'
      );

      setIndexingStatus("Indexing completed successfully!");
      setSuccess(`Successfully indexed ${result.files_processed || 0} files with ${result.chunks_indexed || 0} chunks`);
      setGithubUrl("");

      // Reload the indexed files list
      await loadIndexedFiles();

    } catch (err) {
      console.error("Error indexing runbooks:", err);
      setError(`Failed to index runbooks: ${err.message}`);
      setIndexingStatus("");
    } finally {
      setIsIndexing(false);
    }
  };

  const handleReindexAll = async () => {
    setIsIndexing(true);
    setError("");
    setSuccess("");
    setIndexingStatus("Reindexing all runbooks...");

    try {
      const result = await apiClient.reindexRunbooks();
      setSuccess(`Successfully reindexed ${result.sources_reindexed || 0} sources with ${result.chunks_indexed || 0} chunks`);
      setIndexingStatus("");

      // Reload the indexed files list after successful reindex
      await loadIndexedFiles();

    } catch (err) {
      console.error("Error reindexing:", err);
      setError(`Failed to reindex: ${err.message}`);
      setIndexingStatus("");
    } finally {
      setIsIndexing(false);
    }
  };

  const handleTestRetrieval = async () => {
    try {
      const result = await apiClient.testRunbookRetrieval();
      setSuccess(`Test completed! Found runbooks for ${result.total_tests} test cases`);
    } catch (err) {
      setError(`Test failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Runbook Management
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Index and manage runbooks from GitHub repositories
              </p>
            </div>
            <div className="flex space-x-3">
              <Button
                onClick={handleReindexAll}
                variant="outline"
                color="neutral"
                disabled={isIndexing}
              >
                Reindex All
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Document Statistics */}
        {documentStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Unique Files</p>
                  <p className="text-2xl font-semibold text-gray-900 dark:text-white">{documentStats.total_documents}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Chunks</p>
                  <p className="text-2xl font-semibold text-gray-900 dark:text-white">{documentStats.total_chunks}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-8 w-8 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Source Types</p>
                  <p className="text-2xl font-semibold text-gray-900 dark:text-white">{Object.keys(documentStats.sources).length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-8 w-8 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Collection</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">{documentStats.collection_name}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Index New Runbooks - Full Width */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Index Runbooks from GitHub
            </h2>

            <form onSubmit={handleIndexRunbooks} className="space-y-4">
              <div>
                <label htmlFor="github-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  GitHub URL
                </label>
                <input
                  type="url"
                  id="github-url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/repo or https://github.com/username/repo/blob/main/runbook.md"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  disabled={isIndexing}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Enter a GitHub repository URL or direct link to a markdown file
                </p>
              </div>

              <Button
                type="submit"
                variant="solid"
                color="primary"
                disabled={isIndexing}
                className="w-full"
              >
                {isIndexing ? "Indexing..." : "Index Runbooks"}
              </Button>
            </form>

            {/* Status Messages */}
            {indexingStatus && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-sm text-blue-700 dark:text-blue-300">{indexingStatus}</p>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {success && (
              <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
              </div>
            )}

            {/* Usage Examples */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                Supported URL formats:
              </h3>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Repository: https://github.com/username/runbooks</li>
                <li>• Specific file: https://github.com/username/repo/blob/main/runbook.md</li>
                <li>• Directory: https://github.com/username/repo/tree/main/docs</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Indexed Runbooks List - Full Width */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Indexed Runbooks
            </h2>

            {indexedFiles.length === 0 ? (
              <div className="text-center py-8">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  No runbooks indexed yet
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Add a GitHub URL above to get started
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {indexedFiles.map((file) => (
                  <div key={file.id} className="border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                          {file.name}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Source: {file.source}
                        </p>
                        {file.source_display && file.source_display !== file.source && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            File: {file.source_display}
                          </p>
                        )}
                        {file.chunk_count && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {file.chunk_count} chunk{file.chunk_count > 1 ? 's' : ''} indexed
                          </p>
                        )}
                        {file.content_preview && (
                          <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300">
                            <p className="font-medium mb-1">Content Preview:</p>
                            <p className="line-clamp-3">{file.content_preview}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end space-y-2">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          file.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
                        }`}>
                          {file.status}
                        </span>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          ID: {file.id.substring(0, 8)}...
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Source Breakdown */}
            {documentStats && Object.keys(documentStats.sources).length > 0 && (
              <div className="mt-6 border-t border-gray-200 dark:border-gray-600 pt-6">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Source Breakdown
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(documentStats.sources).map(([source, count]) => (
                    <div key={source} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{source}</span>
                      <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* How it Works Section */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              How Runbook Indexing Works
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">1. Fetch Content</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  System fetches markdown files from GitHub repositories or specific file URLs
                </p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 mx-auto bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">2. AI Processing</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Content is processed and chunked for optimal vector similarity search
                </p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 mx-auto bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">3. Smart Retrieval</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  AI automatically suggests relevant runbooks based on incident context
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
