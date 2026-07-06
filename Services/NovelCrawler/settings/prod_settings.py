from pathlib import Path

BOT_NAME = "novelcrawler"
ROBOTSTXT_OBEY = False
NEWSPIDER_MODULE = "spiders"
SPIDER_MODULES = ["spiders"]

DOWNLOADERMIDDLEWARES = {
    "scrapy.downloadermiddlewares.httpcompression.HttpCompressionMiddleware": None,
}

DOWNLOAD_HANDLERS = {
    "http": "handlers.selenium_handler.SeleniumHandler",
    "https": "handlers.selenium_handler.SeleniumHandler",
}

DOWNLOAD_DELAY = 1.5
CONCURRENT_REQUESTS_PER_DOMAIN = 2

SCHEDULER_DISK_QUEUE = "scrapy.squeues.PickleLifoDiskQueue"
SCHEDULER_MEMORY_QUEUE = "scrapy.squeues.LifoMemoryQueue"
SCHEDULER_PRIORITY_QUEUE = "scrapy.pqueues.DownloaderAwarePriorityQueue"

AUTOTHROTTLE_ENABLED = False

RETRY_ENABLED = True
RETRY_TIMES = 5
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
}

LOG_FILE = Path("logs/scrapy.log")
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
LOG_LEVEL = "DEBUG"

ITEM_PIPELINES = {
    "pipelines.json_writer.JsonWriterPipeline": 300,
    "pipelines.csv_writer.CsvWriterPipeline": 400,
}

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)

DEPTH_LIMIT = 2
DEPTH_PRIORITY = 1
