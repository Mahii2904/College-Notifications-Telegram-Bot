import { load } from "cheerio";
import axios from "axios";

const BASE_URL = "https://geca.ac.in/default.aspx";
const ROOT_URL = "https://geca.ac.in/";

export async function getNotices(n = 5) {
  const response = await axios.get(BASE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    },
  });

  const $ = load(response.data);
  const notices = [];

  if (n < 1 || n > 10) return notices;

  $("ul.scrollNews li a")
    .slice(0, n)
    .each((_, element) => {
      const text = $(element).text().trim();
      const href = $(element).attr("href") || "";

      const link = href.startsWith("http")
        ? href
        : ROOT_URL + href.replace(/^\/+/, "");

      if (text) {
        notices.push({ text, link });
      }
    });

  return notices;
}
