function CSXSWindowType()
{
};

CSXSWindowType._PANEL = "Panel";

CSXSWindowType._MODELESS = "Modeless";

CSXSWindowType._MODAL_DIALOG = "ModalDialog";

EvalScript_ErrMessage = "EvalScript error.";

function Version(major, minor, micro, special)
{
    this.major = major;
    this.minor = minor;
    this.micro = micro;
    this.special = special;
};

Version.MAX_NUM = 999999999;

function VersionBound(version, inclusive)
{
    this.version = version;
    this.inclusive = inclusive;
};

function VersionRange(lowerBound, upperBound)
{
    this.lowerBound = lowerBound;
    this.upperBound = upperBound;
};

function Runtime(name, versionRange)
{
    this.name = name;
    this.versionRange = versionRange;
};

function Extension(id, name, mainPath, basePath, windowType, width, height, minWidth, minHeight, maxWidth, maxHeight,
                   defaultExtensionDataXml, specialExtensionDataXml, requiredRuntimeList, isAutoVisible, isPluginExtension)
{
    this.id = id;
    this.name = name;
    this.mainPath = mainPath;
    this.basePath = basePath;
    this.windowType = windowType;
    this.width = width;
    this.height = height;
    this.minWidth = minWidth;
    this.minHeight = minHeight;
    this.maxWidth = maxWidth;
    this.maxHeight = maxHeight;
    this.defaultExtensionDataXml = defaultExtensionDataXml;
    this.specialExtensionDataXml = specialExtensionDataXml;
    this.requiredRuntimeList = requiredRuntimeList;
    this.isAutoVisible = isAutoVisible;
    this.isPluginExtension = isPluginExtension;
};

function CSEvent(type, scope, appId, extensionId)
{
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
};

CSEvent.prototype.data = "";

function SystemPath()
{
};

SystemPath.USER_DATA = "userData";

SystemPath.COMMON_FILES = "commonFiles";

SystemPath.MY_DOCUMENTS = "myDocuments";

SystemPath.APPLICATION = "application";

SystemPath.EXTENSION = "extension";

SystemPath.HOST_APPLICATION = "hostApplication";

function ColorType()
{
};

ColorType.RGB = "rgb";

ColorType.GRADIENT = "gradient";

ColorType.NONE = "none";

function RGBColor(red, green, blue, alpha)
{
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha;
};

function Direction(x, y)
{
    this.x = x;
    this.y = y;
};

function GradientStop(offset, rgbColor)
{
    this.offset = offset;
    this.rgbColor = rgbColor;
};

function GradientColor(type, direction, numStops, arrGradientStop)
{
    this.type = type;
    this.direction = direction;
    this.numStops = numStops;
    this.arrGradientStop = arrGradientStop;
};

function UIColor(type, antialiasLevel, color)
{
    this.type = type;
    this.antialiasLevel = antialiasLevel;
    this.color = color;
};

function AppSkinInfo(baseFontFamily, baseFontSize, appBarBackgroundColor, panelBackgroundColor, appBarBackgroundColorSRGB, panelBackgroundColorSRGB, systemHighlightColor)
{
    this.baseFontFamily = baseFontFamily;
    this.baseFontSize = baseFontSize;
    this.appBarBackgroundColor = appBarBackgroundColor;
    this.panelBackgroundColor = panelBackgroundColor;
    this.appBarBackgroundColorSRGB = appBarBackgroundColorSRGB;
    this.panelBackgroundColorSRGB = panelBackgroundColorSRGB;
    this.systemHighlightColor = systemHighlightColor;
};

function HostEnvironment(appName, appVersion, appLocale, appUILocale, appId, isAppOffline, appSkinInfo)
{
    this.appName = appName;
    this.appVersion = appVersion;
    this.appLocale = appLocale;
    this.appUILocale = appUILocale;
    this.appId = appId;
    this.isAppOffline = isAppOffline;
    this.appSkinInfo = appSkinInfo;
};

function CSInterface()
{
};

CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

CSInterface.prototype.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());

CSInterface.prototype.getHostEnvironment = function()
{
    this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    return this.hostEnvironment;
};

CSInterface.prototype.closeExtension = function()
{
    window.__adobe_cep__.closeExtension();
};

CSInterface.prototype.getSystemPath = function(pathType)
{
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0)
    {
      path = path.replace("file:///", "");
    }
    else if (OSVersion.indexOf("Mac") >= 0)
    {
      path = path.replace("file://", "");
    }
    return path;
};

CSInterface.prototype.evalScript = function(script, callback)
{
    if(callback == null || callback == undefined)
    {
        callback = function(result){};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getApplicationID = function()
{
    var appId = this.hostEnvironment.appId;
    return appId;
};

CSInterface.prototype.getHostCapabilities = function()
{
    var hostCapabilities = JSON.parse(window.__adobe_cep__.getHostCapabilities() );
    return hostCapabilities;
};

CSInterface.prototype.dispatchEvent = function(event)
{
    if (typeof event.data == "object")
    {
        event.data = JSON.stringify(event.data);
    }

    window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.addEventListener = function(type, listener, obj)
{
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function(type, listener, obj)
{
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.requestOpenExtension = function(extensionId, params)
{
    window.__adobe_cep__.requestOpenExtension(extensionId, params);
};

CSInterface.prototype.getExtensions = function(extensionIds)
{
    var extensionIdsStr = JSON.stringify(extensionIds);
    var extensionsStr = window.__adobe_cep__.getExtensions(extensionIdsStr);

    var extensions = JSON.parse(extensionsStr);
    return extensions;
};

CSInterface.prototype.getNetworkPreferences = function()
{
    var result = window.__adobe_cep__.getNetworkPreferences();
    var networkPre = JSON.parse(result);

    return networkPre;
};

CSInterface.prototype.initResourceBundle = function()
{
    var resourceBundle = JSON.parse(window.__adobe_cep__.initResourceBundle());
    var resElms = document.querySelectorAll('[data-locale]');
    for (var n = 0; n < resElms.length; n++)
    {
       var resEl = resElms[n];

       var resKey = resEl.getAttribute('data-locale');
       if (resKey)
       {

           for (var key in resourceBundle)
           {
               if (key.indexOf(resKey) == 0)
               {
                   var resValue = resourceBundle[key];
                   if (key.indexOf('.') == -1)
                   {

                       resEl.innerHTML = resValue;
                   }
                   else
                   {

                       var attrKey = key.substring(key.indexOf('.') + 1);
                       resEl[attrKey] = resValue;
                   }
               }
           }
       }
    }
    return resourceBundle;
};

CSInterface.prototype.dumpInstallationInfo = function()
{
    return window.__adobe_cep__.dumpInstallationInfo();
};

CSInterface.prototype.getOSInformation = function()
{
    var userAgent = navigator.userAgent;

    if ((navigator.platform == "Win32") || (navigator.platform == "Windows"))
    {
        var winVersion = "Windows platform";
        if (userAgent.indexOf("Windows NT 5.0") > -1)
        {
            winVersion = "Windows 2000";
        }
        else if (userAgent.indexOf("Windows NT 5.1") > -1)
        {
            winVersion = "Windows XP";
        }
        else if (userAgent.indexOf("Windows NT 5.2") > -1)
        {
            winVersion = "Windows Server 2003";
        }
        else if (userAgent.indexOf("Windows NT 6.0") > -1)
        {
            winVersion = "Windows Vista";
        }
        else if (userAgent.indexOf("Windows NT 6.1") > -1)
        {
            winVersion = "Windows 7";
        }
        else if (userAgent.indexOf("Windows NT 6.2") > -1)
        {
            winVersion = "Windows 8";
        }

        var winBit = "32-bit";
        if (userAgent.indexOf("WOW64") > -1)
        {
            winBit = "64-bit";
        }

        return winVersion + " " + winBit;
    }
    else if ((navigator.platform == "MacIntel") || (navigator.platform == "Macintosh"))
    {
        var agentStr = new String();
        agentStr = userAgent;
        var verLength = agentStr.indexOf(")") - agentStr.indexOf("Mac OS X");
        var verStr = agentStr.substr(agentStr.indexOf("Mac OS X"), verLength);
        var result = verStr.replace("_", ".");
        result = result.replace("_", ".");
        return result;
    }

    return "Unknown Operation System";
};

CSInterface.prototype.openURLInDefaultBrowser = function(url)
{
    return cep.util.openURLInDefaultBrowser(url);
};
