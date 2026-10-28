import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Wayland
import Quickshell.Io

ShellRoot {
    id: root
    readonly property string target: Quickshell.env("GEMINI_DOT_SCREEN")
    readonly property var points: JSON.parse(Quickshell.env("GEMINI_DOT_POINTS") || "[]")
    readonly property string answerText: Quickshell.env("GEMINI_DOT_TEXT") || ""
    readonly property int duration: Number(Quickshell.env("GEMINI_DOT_DURATION") || "8000")
    IpcHandler {
        target: "dot"
        function hide(): void { Qt.quit() }
    }
    Variants {
        model: Quickshell.screens
        PanelWindow {
            id: panel
            required property var modelData
            screen: modelData
            visible: modelData.name === root.target
            color: "transparent"
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.namespace: "gemini-dot"
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
            anchors { top: true; bottom: true; left: true; right: true }
            mask: Region { item: bubble }
            Rectangle {
                id: bubble
                property bool expanded: false
                visible: root.answerText.length > 0
                width: visible ? Math.min(expanded ? 310 : Math.min(190, Math.ceil(compactMetrics.advanceWidth) + 8), panel.width - 24) : 0
                height: visible ? (expanded ? 166 : Math.ceil(compactText.implicitHeight) + 4) : 0
                x: 12
                y: panel.height - height - 12
                color: "#ee202328"
                radius: expanded ? 7 : 3
                border.color: "#667078"
                TextMetrics {
                    id: compactMetrics
                    font: compactText.font
                    text: compactText.text
                }
                Text {
                    id: compactText
                    visible: !bubble.expanded
                    anchors { fill: parent; leftMargin: 4; rightMargin: 4 }
                    text: root.answerText.replace(/\s+/g, " ")
                    color: "#f1f3f5"
                    font.pixelSize: 12
                    verticalAlignment: Text.AlignVCenter
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                }
                MouseArea {
                    anchors.fill: parent
                    enabled: !bubble.expanded
                    onClicked: bubble.expanded = true
                }
                ScrollView {
                    visible: bubble.expanded
                    anchors { top: parent.top; left: parent.left; right: parent.right; bottom: copyButton.top; margins: 9 }
                    clip: true
                    TextArea {
                        text: root.answerText
                        textFormat: TextEdit.PlainText
                        readOnly: true
                        selectByMouse: true
                        wrapMode: TextEdit.Wrap
                        font.pixelSize: 13
                        color: "#f1f3f5"
                        background: null
                        id: answerField
                    }
                }
                Button {
                    visible: bubble.expanded
                    id: copyButton
                    text: "Копіювати"
                    height: 26
                    anchors { bottom: parent.bottom; left: parent.left; margins: 7 }
                    onClicked: { answerField.selectAll(); answerField.copy(); answerField.deselect() }
                }
                Button {
                    visible: bubble.expanded
                    text: "×"
                    height: 26
                    width: 30
                    anchors { bottom: parent.bottom; right: parent.right; margins: 7 }
                    onClicked: Qt.quit()
                }
            }
            Repeater {
                model: root.points
                delegate: Rectangle {
                    required property var modelData
                    width: 7
                    height: 7
                    radius: 3.5
                    color: "black"
                    x: Math.max(0, Math.min(panel.width - width, modelData.x * panel.width / 1000 - width / 2))
                    y: Math.max(0, Math.min(panel.height - height, modelData.y * panel.height / 1000 - height / 2))
                }
            }
        }
    }
    Timer { interval: root.duration; running: true; onTriggered: Qt.quit() }
}
