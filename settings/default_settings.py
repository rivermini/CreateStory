from pathlib import Path

DOWNLOADERMIDDLEWARES = {
    "scrapy.downloadermiddlewares.httpcompression.HttpCompressionMiddleware": None,
}

SCHEDULER_DISK_QUEUE = "scrapy.squeues.PickleLifoDiskQueue"
SCHEDULER_MEMORY_QUEUE = "scrapy.squeues.LifoMemoryQueue"
SCHEDULER_PRIORITY_QUEUE = "scrapy.pqueues.DownloaderAwarePriorityQueue"

DOWNLOAD_HANDLERS = {
    "http": "handlers.selenium_handler.SeleniumHandler",
    "https": "handlers.selenium_handler.SeleniumHandler",
}

BOT_NAME = "novelcrawler"
ROBOTSTXT_OBEY = False

NEWSPIDER_MODULE = "spiders"
SPIDER_MODULES = ["spiders"]

DOWNLOAD_DELAY = 2.0
CONCURRENT_REQUESTS_PER_DOMAIN = 1

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 2.0
AUTOTHROTTLE_MAX_DELAY = 15.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0

RETRY_ENABLED = True
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

DEFAULT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
LOG_DATEFORMAT = "%Y-%m-%d %H:%M:%S"

OUTPUT_FORMAT = "both"

ITEM_PIPELINES = {
    "pipelines.json_writer.JsonWriterPipeline": 300,
    "pipelines.csv_writer.CsvWriterPipeline": 400,
    "pipelines.md_writer.MdWriterPipeline": 500,
}

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)

CUSTOM_OUTPUT_DIR = None
CUSTOM_FILENAME_PREFIX = None

DEPTH_LIMIT = 2
DEPTH_PRIORITY = 1
