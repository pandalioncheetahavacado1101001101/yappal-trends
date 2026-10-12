'use strict';
/*
 * Outlets by the address a feed names them with (ios/IDEAS-FEED.md J4, M5): Google News names some outlets by their address, and
 * GDELT knows every outlet only by it. An outlet named here reads as it calls itself ("people.com" is "People"), so one outlet
 * is one outlet whichever feed carried its headline. Pure data.
 */
const OUTLET_BY_DOMAIN = { 'primetimer.com': 'PrimeTimer', 'people.com': 'People', 'today.com': 'Today', 'aol.com': 'AOL', 'aol.ca': 'AOL', 'intouchweekly.com': 'In Touch Weekly',
  'usmagazine.com': 'Us Weekly', 'yahoo.com': 'Yahoo', 'nypost.com': 'New York Post', 'dailymail.co.uk': 'Daily Mail', 'eonline.com': 'E! News', 'tmz.com': 'TMZ', 'ign.com': 'IGN',
  'cbsnews.com': 'CBS News', 'nbcnews.com': 'NBC News', 'foxnews.com': 'Fox News', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'cnn.com': 'CNN', 'complex.com': 'Complex', 'dexerto.com': 'Dexerto',
  'variety.com': 'Variety', 'deadline.com': 'Deadline', 'billboard.com': 'Billboard', 'pagesix.com': 'Page Six', 'hollywoodreporter.com': 'The Hollywood Reporter', 'ew.com': 'Entertainment Weekly',
  'buzzfeed.com': 'BuzzFeed', 'insider.com': 'Business Insider', 'businessinsider.com': 'Business Insider', 'thedailybeast.com': 'The Daily Beast', 'newsweek.com': 'Newsweek', 'forbes.com': 'Forbes' };

module.exports = { OUTLET_BY_DOMAIN };
