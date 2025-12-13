import { load } from "cheerio";
import axios from "axios";

const BASE_URL = "https://geca.ac.in/default.aspx";
const ROOT_URL = "https://geca.ac.in/";

export async function getNotices(n = 5) {
  const download = await axios.get(BASE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    },
  });

  const $ = load(download.data);

  let result = "";

  if (n > 0 && n <= 10) {
    $("ul.scrollNews li a")
      .slice(0, n)
      .each((index, element) => {
        let text = $(element).text().trim();
        let href = $(element).attr("href") || "";

        let link = href.startsWith("http")
          ? href
          : ROOT_URL + encodeURIComponent(href);

        result += `${index + 1}. ${text}\n${link}\n\n`;
      });

    if (!result) {
      result = "No notifications found.";
    }
  } else {
    result = `Invalid input - cannot fetch ${n} results`;
  }

  return result;
}
