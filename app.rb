require "sinatra"
require "nokogiri"
require "open-uri"

configure do
  disable :static
end

class BedarssApp < Sinatra::Base
  get "/" do
    document = Nokogiri::HTML.parse(URI.open("http://lpu.cz/beda/"))
    document.xpath("//comment()").remove
    document.css("br").remove
    @items = document.css("li")

    headers "Content-Type" => "application/xml"
    erb :index
  end
end
