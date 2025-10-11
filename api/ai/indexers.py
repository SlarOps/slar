"""
Document indexer classes for processing and indexing various document sources.
"""

import os
import re
import aiofiles
import aiohttp
from io import BytesIO
import zipfile
from typing import List, Optional
from autogen_core.memory import Memory, MemoryContent, MemoryMimeType


class SimpleDocumentIndexer:
    """Basic document indexer for AutoGen Memory."""

    def __init__(self, memory: Memory, chunk_size: int = 1500) -> None:
        self.memory = memory
        self.chunk_size = chunk_size

    async def _fetch_content(self, source: str) -> str:
        """Fetch content from URL or file."""
        if source.startswith(("http://", "https://")):
            async with aiohttp.ClientSession() as session:
                async with session.get(source) as response:
                    return await response.text()
        else:
            async with aiofiles.open(source, "r", encoding="utf-8") as f:
                return await f.read()

    def _strip_html(self, text: str) -> str:
        """Remove HTML tags and normalize whitespace."""
        text = re.sub(r"<[^>]*>", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        # Just split text into fixed-size chunks
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    async def index_documents(self, sources: List[str]) -> int:
        """Index documents into memory."""
        total_chunks = 0

        for source in sources:
            try:
                content = await self._fetch_content(source)

                # Strip HTML if content appears to be HTML
                if "<" in content and ">" in content:
                    content = self._strip_html(content)

                chunks = self._split_text(content)

                for i, chunk in enumerate(chunks):
                    await self.memory.add(
                        MemoryContent(
                            content=chunk, mime_type=MemoryMimeType.TEXT, metadata={"source": source, "chunk_index": i}
                        )
                    )

                total_chunks += len(chunks)

            except Exception as e:
                print(f"Error indexing {source}: {str(e)}")

        return total_chunks


class ContentDocumentIndexer:
    """Basic document indexer for AutoGen Memory."""

    def __init__(self, memory: Memory, chunk_size: int = 1500) -> None:
        self.memory = memory
        self.chunk_size = chunk_size

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        # Just split text into fixed-size chunks
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    async def index_documents(self, contents: List[str]) -> int:
        """Index documents into memory."""
        total_chunks = 0
        for content in contents:
            chunks = self._split_text(content)
            for i, chunk in enumerate(chunks):
                await self.memory.add(
                    MemoryContent(
                        content=chunk, mime_type=MemoryMimeType.TEXT, metadata={"source": "runbook", "chunk_index": i}
                    )
                )
            total_chunks += len(chunks)
        return total_chunks


class GitHubDocumentIndexer:
    """GitHub document indexer for fetching and indexing runbooks from GitHub."""

    def __init__(
        self, memory: Memory, chunk_size: int = 1500, github_token: Optional[str] = None
    ) -> None:
        self.memory = memory
        self.chunk_size = chunk_size
        self.github_token = github_token or os.getenv("GITHUB_TOKEN")

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    def _auth_headers(self) -> dict:
        return {"Authorization": f"token {self.github_token}"} if self.github_token else {}

    async def _fetch_github_content(self, url: str) -> str:
        """Fetch content from GitHub URL."""
        # Convert GitHub URL to raw content URL
        if "/blob/" in url:
            # Convert blob URL to raw URL
            raw_url = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        else:
            # For repository URLs, we'll need to fetch the API
            raw_url = url

        async with aiohttp.ClientSession() as session:
            async with session.get(raw_url, headers=self._auth_headers()) as response:
                if response.status == 200:
                    return await response.text()
                else:
                    raise Exception(f"Failed to fetch content from {raw_url}: {response.status}")

    async def _fetch_github_repo_files(self, repo_url: str, branch: str = "main") -> List[tuple[str, str]]:
        """
        Efficiently fetch markdown-like files from a GitHub repository by downloading a single tarball/zipball.
        Returns a list of (relative_path, file_content) tuples.
        """
        parts = repo_url.replace("https://github.com/", "").strip("/").split("/")
        if len(parts) < 2:
            raise Exception("Invalid GitHub repository URL")
        owner, repo = parts[0], parts[1]

        # Use zipball to avoid many API calls and recursion limits
        zipball_api = f"https://api.github.com/repos/{owner}/{repo}/zipball/{branch}"

        async with aiohttp.ClientSession() as session:
            async with session.get(zipball_api, headers=self._auth_headers()) as response:
                if response.status != 200:
                    raise Exception(f"Failed to download repository archive: {response.status}")
                data = await response.read()

        # Unpack zip in-memory and collect target files
        results: List[tuple[str, str]] = []
        with zipfile.ZipFile(BytesIO(data)) as zf:
            for name in zf.namelist():
                # Skip directories
                if name.endswith("/"):
                    continue
                # Only index likely text runbooks
                if not (name.lower().endswith(".md") or name.lower().endswith(".txt") or name.lower().endswith(".rst")):
                    continue
                with zf.open(name, "r") as f:
                    raw_bytes = f.read()
                    try:
                        content = raw_bytes.decode("utf-8", errors="ignore")
                    except Exception:
                        # If decode fails, skip file
                        continue
                    # Remove the leading repo folder prefix in the archive (owner-repo-<sha>/)
                    path_parts = name.split("/", 1)
                    relative_path = path_parts[1] if len(path_parts) > 1 else name
                    results.append((relative_path, content))
        return results

    async def index_github_content(self, github_url: str, branch: str = "main") -> dict:
        """Index content from GitHub URL (repository or specific file)."""
        files_processed = 0
        total_chunks = 0

        try:
            if "/blob/" in github_url or github_url.endswith((".md", ".txt", ".rst")):
                # Single file URL
                content = await self._fetch_github_content(github_url)
                chunks = self._split_text(content)

                for i, chunk in enumerate(chunks):
                    await self.memory.add(
                        MemoryContent(
                            content=chunk,
                            mime_type=MemoryMimeType.TEXT,
                            metadata={
                                "source": "github_runbook",
                                "github_url": github_url,
                                "path": github_url.split("/")[-1],
                                "chunk_index": i
                            }
                        )
                    )

                files_processed = 1
                total_chunks = len(chunks)

            else:
                # Repository URL - fetch all markdown/text files via zipball
                file_entries = await self._fetch_github_repo_files(github_url, branch)
                for relative_path, file_content in file_entries:
                    chunks = self._split_text(file_content)
                    for i, chunk in enumerate(chunks):
                        await self.memory.add(
                            MemoryContent(
                                content=chunk,
                                mime_type=MemoryMimeType.TEXT,
                                metadata={
                                    "source": "github_runbook",
                                    "github_url": github_url,
                                    "path": relative_path,
                                    "chunk_index": i,
                                },
                            )
                        )
                    total_chunks += len(chunks)
                files_processed = len(file_entries)

            return {
                "files_processed": files_processed,
                "chunks_indexed": total_chunks
            }

        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error indexing GitHub content: {str(e)}")
            raise
