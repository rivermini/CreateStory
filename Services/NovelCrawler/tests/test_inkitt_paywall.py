from unittest.mock import patch, MagicMock
from api.services.site_service import _fetch_inkitt_metadata
from api.routes.sites import _fetch_inkitt_chapters


@patch("requests.get")
def test_fetch_inkitt_metadata_paywalled(mock_get):
    # Mocking requests.get response
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = """
    <html>
      <head>
        <script type="application/ld+json">
          {"@type": "Article", "headline": "Test Paywall Story", "author": {"name": "Test Author"}, "image": "http://example.com/cover.jpg", "description": "Synop"}
        </script>
      </head>
      <body>
        <h1>Test Paywall Story</h1>
        <script>
          globalData.authorPatronTiers = [{"id":123,"name":"Tier 1"}];
        </script>
      </body>
    </html>
    """
    mock_get.return_value = mock_resp

    title, metadata = _fetch_inkitt_metadata("https://www.inkitt.com/stories/679615")
    assert title == "Test Paywall Story"
    assert metadata is not None
    assert metadata.is_paywalled is True


@patch("api.db.SessionLocal")
@patch("api.repositories.inkitt_cookie_repository.InkittCookieRepository")
@patch("requests.Session.get")
def test_fetch_inkitt_chapters_paywalled(mock_session_get, mock_repo_class, mock_session_local_class):
    # Mock database session and repository
    mock_repo = MagicMock()
    mock_repo.get_valid.return_value = []
    mock_repo.get_user_agent.return_value = None
    mock_repo_class.return_value = mock_repo

    # Mocking session.get in _fetch_inkitt_chapters
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = """
    <html>
      <body>
        <h1>Test Paywall Story</h1>
        <div id="patron-tiers">Author tiers block</div>
        <a href="/stories/679615/chapters/1">1 Chapter 1</a>
        <a href="/stories/679615/chapters/2">2 Chapter 2</a>
      </body>
    </html>
    """
    mock_session_get.return_value = mock_resp

    chapters, warning, total_count, story_title = _fetch_inkitt_chapters("https://www.inkitt.com/stories/679615")
    assert warning == "This story requires an author subscription to read fully."
    assert total_count == 2
