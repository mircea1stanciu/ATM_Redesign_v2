"""
Messaging API routes for UnifiedWork
Real-time messaging functionality with WebSocket support
"""

import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session, joinedload

from core.auth import get_current_user
from core.database import (
    Conversation,
    ConversationParticipant,
    Message,
    MessageType,
    User,
    UserPresence,
    UserStatus,
    get_db,
)

router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])

# Pydantic models for API
class UserPresenceResponse(BaseModel):
    user_id: int
    username: str
    full_name: str
    status: str
    last_seen: Optional[datetime]
    is_typing: bool

class FileAttachment(BaseModel):
    id: int
    filename: str
    original_filename: str
    file_size: int
    content_type: str
    upload_url: str

class MessageResponse(BaseModel):
    id: int
    content: str
    message_type: str
    sender_id: int
    sender_username: str
    sender_full_name: str
    created_at: datetime
    edited: bool
    edited_at: Optional[datetime]
    reply_to_message_id: Optional[int]
    attachments: Optional[list[FileAttachment]] = []
    reactions: Optional[dict[str, list[dict]]] = {}

class ConversationResponse(BaseModel):
    id: int
    name: Optional[str]
    is_group: bool
    last_activity: datetime
    participant_count: int
    unread_count: int
    last_message: Optional[MessageResponse]

class ConversationDetailResponse(BaseModel):
    id: int
    name: Optional[str]
    is_group: bool
    participants: list[UserPresenceResponse]
    messages: list[MessageResponse]
    created_at: datetime

class CreateMessageRequest(BaseModel):
    content: str
    message_type: str = "text"
    reply_to_message_id: Optional[int] = None

class CreateConversationRequest(BaseModel):
    participant_user_ids: list[int]
    name: Optional[str] = None
    is_group: bool = False

class UpdatePresenceRequest(BaseModel):
    status: str
    is_typing: bool = False
    typing_in_conversation: Optional[int] = None


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}  # user_id -> list of websockets
        self.user_organizations: dict[int, int] = {}  # user_id -> organization_id

    async def connect(self, websocket: WebSocket, user_id: int, organization_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        self.user_organizations[user_id] = organization_id

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                if user_id in self.user_organizations:
                    del self.user_organizations[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    # Connection might be closed, will be cleaned up on disconnect
                    pass

    async def broadcast_to_organization(self, message: dict, organization_id: int, exclude_user_id: Optional[int] = None):
        # Create a copy to avoid "dictionary changed size during iteration" error
        user_orgs = dict(self.user_organizations)
        for user_id, user_org_id in user_orgs.items():
            if user_org_id == organization_id and user_id != exclude_user_id:
                await self.send_personal_message(message, user_id)

    async def broadcast_to_conversation(self, message: dict, conversation_id: int, db: Session, exclude_user_id: Optional[int] = None):
        # Get all participants in the conversation
        participants = db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.is_active
        ).all()
        
        print(f"DEBUG broadcast_to_conversation: Found {len(participants)} active participants for conversation {conversation_id}")
        
        for participant in participants:
            if participant.user_id != exclude_user_id:
                print(f"DEBUG: Sending message to user {participant.user_id}, connected: {participant.user_id in self.active_connections}")
                await self.send_personal_message(message, participant.user_id)

manager = ConnectionManager()


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, db: Session = Depends(get_db)):
    """WebSocket endpoint for real-time messaging"""
    # TODO: Add authentication for WebSocket connections
    # For now, we'll trust the user_id parameter
    
    # Get user and organization
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    
    organization_id = user.organization_id
    await manager.connect(websocket, user_id, organization_id)
    
    # Update user presence to online
    presence = db.query(UserPresence).filter(
        UserPresence.user_id == user_id,
        UserPresence.organization_id == organization_id
    ).first()
    
    if not presence:
        presence = UserPresence(
            user_id=user_id,
            organization_id=organization_id,
            status=UserStatus.ONLINE,
            last_seen=datetime.utcnow()
        )
        db.add(presence)
    else:
        presence.status = UserStatus.ONLINE
        presence.last_seen = datetime.utcnow()
    
    db.commit()
    
    # Broadcast presence update
    await manager.broadcast_to_organization({
        "type": "presence_update",
        "user_id": user_id,
        "status": "online",
        "last_seen": datetime.utcnow().isoformat()
    }, organization_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "typing":
                # Handle typing indicators
                conversation_id = data.get("conversation_id")
                is_typing = data.get("is_typing", False)
                
                presence.is_typing = is_typing
                presence.typing_in_conversation = conversation_id if is_typing else None
                db.commit()
                
                # Broadcast typing status to conversation participants
                await manager.broadcast_to_conversation({
                    "type": "typing_update",
                    "user_id": user_id,
                    "conversation_id": conversation_id,
                    "is_typing": is_typing
                }, conversation_id, db, exclude_user_id=user_id)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
        
        # Update presence to offline
        if presence:
            presence.status = UserStatus.OFFLINE
            presence.last_seen = datetime.utcnow()
            presence.is_typing = False
            presence.typing_in_conversation = None
            db.commit()
            
            # Broadcast presence update
            await manager.broadcast_to_organization({
                "type": "presence_update",
                "user_id": user_id,
                "status": "offline",
                "last_seen": datetime.utcnow().isoformat()
            }, organization_id)


@router.get("/conversations", response_model=list[ConversationResponse])
async def get_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all conversations for the current user"""
    conversations = db.query(Conversation).join(
        ConversationParticipant
    ).filter(
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active,
        Conversation.organization_id == current_user.organization_id
    ).options(
        joinedload(Conversation.messages).joinedload(Message.sender)
    ).order_by(desc(Conversation.last_activity)).all()
    
    result = []
    for conv in conversations:
        # Get participant info for this user
        participant = db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == conv.id,
            ConversationParticipant.user_id == current_user.id
        ).first()
        
        # Calculate unread count
        unread_count = 0
        if participant.last_read_message_id:
            unread_count = db.query(Message).filter(
                Message.conversation_id == conv.id,
                Message.id > participant.last_read_message_id
            ).count()
        else:
            unread_count = len(conv.messages)
        
        # Get last message
        last_message = None
        if conv.messages:
            last_msg = conv.messages[-1]
            # Create attachment if file exists
            attachments = []
            if last_msg.file_url:
                attachments.append(FileAttachment(
                    id=last_msg.id,
                    filename=last_msg.file_url.split('/')[-1],
                    original_filename=last_msg.file_name or last_msg.file_url.split('/')[-1],
                    file_size=last_msg.file_size or 0,
                    content_type=last_msg.file_type or 'application/octet-stream',
                    upload_url=last_msg.file_url
                ))
                
            last_message = MessageResponse(
                id=last_msg.id,
                content=last_msg.content,
                message_type=last_msg.message_type.value,
                sender_id=last_msg.sender_id,
                sender_username=last_msg.sender.username,
                sender_full_name=last_msg.sender.full_name or last_msg.sender.username,
                created_at=last_msg.created_at,
                edited=last_msg.edited,
                edited_at=last_msg.edited_at,
                reply_to_message_id=last_msg.reply_to_message_id,
                attachments=attachments,
                reactions={}
            )
        
        result.append(ConversationResponse(
            id=conv.id,
            name=conv.name,
            is_group=conv.is_group,
            last_activity=conv.last_activity,
            participant_count=len(conv.participants),
            unread_count=unread_count,
            last_message=last_message
        ))
    
    return result


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation_detail(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get detailed conversation info with messages"""
    # Debug logging
    print(f"DEBUG get_conversation_detail: conversation_id={conversation_id}, user_id={current_user.id}")
    
    # Verify user is participant
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    print(f"DEBUG: Found participant: {participant is not None}")
    if participant:
        print(f"DEBUG: Participant is_active={participant.is_active}")
    
    if not participant:
        # Check if participant exists at all (without is_active filter)
        any_participant = db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == current_user.id
        ).first()
        print(f"DEBUG: Any participant (without is_active filter): {any_participant is not None}")
        if any_participant:
            print(f"DEBUG: Any participant is_active={any_participant.is_active}")
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.organization_id == current_user.organization_id
    ).options(
        joinedload(Conversation.participants).joinedload(ConversationParticipant.user),
        joinedload(Conversation.messages).joinedload(Message.sender)
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Get participant details with presence
    participants = []
    for p in conversation.participants:
        if p.is_active:
            presence = db.query(UserPresence).filter(
                UserPresence.user_id == p.user_id,
                UserPresence.organization_id == current_user.organization_id
            ).first()
            
            participants.append(UserPresenceResponse(
                user_id=p.user_id,
                username=p.user.username,
                full_name=p.user.full_name or p.user.username,
                status=presence.status.value if presence else "offline",
                last_seen=presence.last_seen if presence else None,
                is_typing=presence.is_typing if presence else False
            ))
    
    # Get messages
    messages = []
    for msg in conversation.messages:
        # Create attachment if file exists
        attachments = []
        if msg.file_url:
            attachments.append(FileAttachment(
                id=msg.id,
                filename=msg.file_url.split('/')[-1],
                original_filename=msg.file_name or msg.file_url.split('/')[-1],
                file_size=msg.file_size or 0,
                content_type=msg.file_type or 'application/octet-stream',
                upload_url=msg.file_url
            ))
        
        # Get reactions for this message
        from core.database import MessageReaction
        reactions_query = db.query(MessageReaction).filter(
            MessageReaction.message_id == msg.id
        ).all()
        
        reaction_counts = {}
        for reaction in reactions_query:
            if reaction.emoji not in reaction_counts:
                reaction_counts[reaction.emoji] = []
            reaction_counts[reaction.emoji].append({
                "user_id": reaction.user_id,
                "username": reaction.user.username
            })
            
        messages.append(MessageResponse(
            id=msg.id,
            content=msg.content,
            message_type=msg.message_type.value,
            sender_id=msg.sender_id,
            sender_username=msg.sender.username,
            sender_full_name=msg.sender.full_name or msg.sender.username,
            created_at=msg.created_at,
            edited=msg.edited,
            edited_at=msg.edited_at,
            reply_to_message_id=msg.reply_to_message_id,
            attachments=attachments,
            reactions=reaction_counts
        ))
    
    # Mark as read
    participant.last_read_message_id = messages[-1].id if messages else None
    db.commit()
    
    return ConversationDetailResponse(
        id=conversation.id,
        name=conversation.name,
        is_group=conversation.is_group,
        participants=participants,
        messages=messages,
        created_at=conversation.created_at
    )


@router.post("/conversations", response_model=ConversationDetailResponse)
async def create_conversation(
    request: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new conversation"""
    # Validate participant IDs
    participants = db.query(User).filter(
        User.id.in_(request.participant_user_ids),
        User.organization_id == current_user.organization_id,
        User.is_active
    ).all()
    
    if len(participants) != len(request.participant_user_ids):
        raise HTTPException(status_code=400, detail="Invalid participant IDs")
    
    # Add current user if not in list
    if current_user.id not in request.participant_user_ids:
        participants.append(current_user)
    
    # For non-group chats, check if conversation already exists
    if not request.is_group and len(participants) == 2:
        # Check for existing direct conversation
        existing = db.query(Conversation).join(ConversationParticipant).filter(
            Conversation.organization_id == current_user.organization_id,
            not Conversation.is_group,
            ConversationParticipant.user_id.in_([p.id for p in participants])
        ).group_by(Conversation.id).having(
            func.count(ConversationParticipant.id) == 2
        ).first()
        
        if existing:
            # Reactivate all participants in case conversation was previously deleted
            existing_participants = db.query(ConversationParticipant).filter(
                ConversationParticipant.conversation_id == existing.id
            ).all()
            
            for participant in existing_participants:
                if not participant.is_active:
                    participant.is_active = True
                    print(f"DEBUG: Reactivated participant user_id={participant.user_id} for conversation {existing.id}")
            
            db.commit()
            
            # Return existing conversation
            return await get_conversation_detail(existing.id, current_user, db)
    
    # Create new conversation
    conversation = Conversation(
        organization_id=current_user.organization_id,
        name=request.name,
        is_group=request.is_group,
        last_activity=datetime.utcnow()
    )
    db.add(conversation)
    db.flush()
    
    # Add participants
    for participant in participants:
        conv_participant = ConversationParticipant(
            conversation_id=conversation.id,
            user_id=participant.id,
            is_active=True  # Explicitly set to True
        )
        db.add(conv_participant)
    
    db.commit()
    db.refresh(conversation)
    
    # Debug: Log conversation creation
    print(f"DEBUG: Created conversation {conversation.id} with {len(participants)} participants")
    
    # Verify participants were created
    created_participants = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation.id
    ).all()
    print(f"DEBUG: Found {len(created_participants)} participants in DB")
    for p in created_participants:
        print(f"DEBUG: Participant user_id={p.user_id}, is_active={p.is_active}")
    
    # Broadcast conversation creation to participants
    broadcast_message = {
        "type": "conversation_created",
        "conversation_id": conversation.id,
        "created_by": current_user.id
    }
    print(f"DEBUG: Broadcasting conversation_created to conversation {conversation.id}")
    await manager.broadcast_to_conversation(broadcast_message, conversation.id, db)
    print("DEBUG: Broadcast complete")
    
    return await get_conversation_detail(conversation.id, current_user, db)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a conversation (mark participant as inactive)"""
    # Verify user is participant
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == current_user.id
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Mark participant as inactive (soft delete)
    participant.is_active = False
    db.commit()
    
    # If all participants are inactive, we could also mark the conversation as deleted
    active_participants = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.is_active
    ).count()
    
    if active_participants == 0:
        conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conversation:
            # Could add a deleted flag or just leave it
            pass
    
    return {"success": True, "message": "Conversation deleted"}


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse)
async def send_message(
    conversation_id: int,
    request: CreateMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message to a conversation"""
    # Verify user is participant
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Create message
    message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=request.content,
        message_type=MessageType(request.message_type),
        reply_to_message_id=request.reply_to_message_id
    )
    db.add(message)
    
    # Update conversation activity
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    conversation.last_activity = datetime.utcnow()
    conversation.last_message_id = message.id
    
    db.commit()
    db.refresh(message)
    
    # Create response (no attachments for regular text messages)
    message_response = MessageResponse(
        id=message.id,
        content=message.content,
        message_type=message.message_type.value,
        sender_id=message.sender_id,
        sender_username=current_user.username,
        sender_full_name=current_user.full_name or current_user.username,
        created_at=message.created_at,
        edited=message.edited,
        edited_at=message.edited_at,
        reply_to_message_id=message.reply_to_message_id,
        attachments=[],
        reactions={}
    )
    
    # Broadcast message to conversation participants
    await manager.broadcast_to_conversation({
        "type": "new_message",
        "conversation_id": conversation_id,
        "message": message_response.dict()
    }, conversation_id, db, exclude_user_id=current_user.id)
    
    return message_response


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_conversation_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all messages from a conversation"""
    # Verify user is participant
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Get messages
    messages = db.query(Message).filter(
        Message.conversation_id == conversation_id
    ).options(
        joinedload(Message.sender)
    ).order_by(Message.created_at).all()
    
    result = []
    for msg in messages:
        # Create attachment if file exists
        attachments = []
        if msg.file_url:
            attachments.append(FileAttachment(
                id=msg.id,
                filename=msg.file_url.split('/')[-1],
                original_filename=msg.file_name or msg.file_url.split('/')[-1],
                file_size=msg.file_size or 0,
                content_type=msg.file_type or 'application/octet-stream',
                upload_url=msg.file_url
            ))
        
        # Get reactions for this message
        from core.database import MessageReaction
        reactions_query = db.query(MessageReaction).filter(
            MessageReaction.message_id == msg.id
        ).all()
        
        reaction_counts = {}
        for reaction in reactions_query:
            if reaction.emoji not in reaction_counts:
                reaction_counts[reaction.emoji] = []
            reaction_counts[reaction.emoji].append({
                "user_id": reaction.user_id,
                "username": reaction.user.username
            })
            
        result.append(MessageResponse(
            id=msg.id,
            content=msg.content,
            message_type=msg.message_type.value,
            sender_id=msg.sender_id,
            sender_username=msg.sender.username,
            sender_full_name=msg.sender.full_name or msg.sender.username,
            created_at=msg.created_at,
            edited=msg.edited,
            edited_at=msg.edited_at,
            reply_to_message_id=msg.reply_to_message_id,
            attachments=attachments,
            reactions=reaction_counts
        ))
    
    # Mark as read
    if result:
        participant.last_read_message_id = result[-1].id
        db.commit()
    
    return result


# File upload configuration
UPLOAD_DIR = "uploads/messages"
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {
    'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 
    'xls', 'xlsx', 'ppt', 'pptx', 'mp4', 'mov', 'avi', 'zip', 'rar'
}

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

def allowed_file(filename: str) -> bool:
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Upload a file for messaging"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    if not allowed_file(file.filename):
        raise HTTPException(
            status_code=400, 
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    # Read file content and check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    
    # Generate unique filename
    file_extension = file.filename.rsplit('.', 1)[1].lower()
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    # Save file
    with open(file_path, "wb") as f:
        f.write(content)
    
    return {
        "filename": unique_filename,
        "original_filename": file.filename,
        "file_size": len(content),
        "content_type": file.content_type,
        "upload_url": f"/api/v1/messaging/files/{unique_filename}"
    }


@router.get("/files/{filename}")
async def download_file(
    filename: str,
    current_user: User = Depends(get_current_user)
):
    """Download a file"""
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type='application/octet-stream'
    )


@router.post("/conversations/{conversation_id}/messages/with-file")
async def send_message_with_file(
    conversation_id: int,
    content: str = "",
    file_info: Optional[dict] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message with an optional file attachment"""
    # Verify user is participant
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Determine message type
    message_type = MessageType.FILE if file_info else MessageType.TEXT
    
    # Create message
    message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=content or (f"📎 {file_info['original_filename']}" if file_info else ""),
        message_type=message_type,
        file_url=file_info.get('upload_url') if file_info else None,
        file_name=file_info.get('original_filename') if file_info else None,
        file_size=file_info.get('file_size') if file_info else None,
        file_type=file_info.get('content_type') if file_info else None
    )
    db.add(message)
    
    # Update conversation activity
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    conversation.last_activity = datetime.utcnow()
    conversation.last_message_id = message.id
    
    db.commit()
    db.refresh(message)
    
    # Create response
    attachment = None
    if file_info:
        attachment = FileAttachment(
            id=message.id,
            filename=file_info['filename'],
            original_filename=file_info['original_filename'],
            file_size=file_info['file_size'],
            content_type=file_info['content_type'],
            upload_url=file_info['upload_url']
        )
    
    message_response = MessageResponse(
        id=message.id,
        content=message.content,
        message_type=message.message_type.value,
        sender_id=message.sender_id,
        sender_username=current_user.username,
        sender_full_name=current_user.full_name or current_user.username,
        created_at=message.created_at,
        edited=message.edited,
        edited_at=message.edited_at,
        reply_to_message_id=message.reply_to_message_id,
        attachments=[attachment] if attachment else [],
        reactions={}
    )
    
    # Broadcast message to conversation participants
    await manager.broadcast_to_conversation({
        "type": "new_message",
        "conversation_id": conversation_id,
        "message": message_response.dict()
    }, conversation_id, db, exclude_user_id=current_user.id)
    
    return message_response


@router.get("/users/search")
async def search_users(
    q: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search for users in the organization"""
    users = db.query(User).filter(
        User.organization_id == current_user.organization_id,
        User.is_active,
        User.id != current_user.id,  # Exclude current user
        or_(
            User.username.ilike(f"%{q}%"),
            User.full_name.ilike(f"%{q}%"),
            User.email.ilike(f"%{q}%")
        )
    ).limit(20).all()
    
    result = []
    for user in users:
        presence = db.query(UserPresence).filter(
            UserPresence.user_id == user.id,
            UserPresence.organization_id == current_user.organization_id
        ).first()
        
        result.append({
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name or user.username,
            "email": user.email,
            "status": presence.status.value if presence else "offline",
            "last_seen": presence.last_seen if presence else None
        })
    
    return result


@router.get("/presence", response_model=list[UserPresenceResponse])
async def get_organization_presence(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get presence information for all users in organization"""
    presence_data = db.query(UserPresence).join(User).filter(
        UserPresence.organization_id == current_user.organization_id,
        User.is_active
    ).all()
    
    result = []
    for presence in presence_data:
        result.append(UserPresenceResponse(
            user_id=presence.user_id,
            username=presence.user.username,
            full_name=presence.user.full_name or presence.user.username,
            status=presence.status.value,
            last_seen=presence.last_seen,
            is_typing=presence.is_typing
        ))
    
    return result


@router.get("/users")
async def get_organization_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all users in the organization for messaging"""
    users = db.query(User).filter(
        User.organization_id == current_user.organization_id,
        User.is_active,
        User.id != current_user.id  # Exclude current user
    ).order_by(User.full_name).all()
    
    result = []
    for user in users:
        presence = db.query(UserPresence).filter(
            UserPresence.user_id == user.id,
            UserPresence.organization_id == current_user.organization_id
        ).first()
        
        result.append({
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name or user.username,
            "email": user.email,
            "status": presence.status.value if presence else "offline",
            "last_seen": presence.last_seen if presence else None,
            "is_online": presence.status.value == "online" if presence else False
        })
    
    return result


# Message Reactions
@router.post("/messages/{message_id}/reactions")
async def add_reaction(
    message_id: int,
    emoji: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add or remove a reaction to a message"""
    from core.database import MessageReaction
    
    # Verify message exists and user has access
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Check if user is participant in the conversation
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == message.conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    if not participant:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Check if reaction already exists
    existing_reaction = db.query(MessageReaction).filter(
        MessageReaction.message_id == message_id,
        MessageReaction.user_id == current_user.id,
        MessageReaction.emoji == emoji
    ).first()
    
    if existing_reaction:
        # Remove reaction
        db.delete(existing_reaction)
        db.commit()
        action = "removed"
    else:
        # Add reaction
        reaction = MessageReaction(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.add(reaction)
        db.commit()
        action = "added"
    
    # Get updated reaction counts
    reactions = db.query(MessageReaction).filter(
        MessageReaction.message_id == message_id
    ).all()
    
    reaction_counts = {}
    for reaction in reactions:
        if reaction.emoji not in reaction_counts:
            reaction_counts[reaction.emoji] = []
        reaction_counts[reaction.emoji].append({
            "user_id": reaction.user_id,
            "username": reaction.user.username
        })
    
    # Broadcast reaction update to conversation participants
    await manager.broadcast_to_conversation({
        "type": "reaction_update",
        "message_id": message_id,
        "emoji": emoji,
        "action": action,
        "user_id": current_user.id,
        "reactions": reaction_counts
    }, message.conversation_id, db)
    
    return {
        "action": action,
        "emoji": emoji,
        "reactions": reaction_counts
    }


@router.get("/messages/{message_id}/reactions")
async def get_reactions(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all reactions for a message"""
    from core.database import MessageReaction
    
    # Verify message exists and user has access
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Check if user is participant in the conversation
    participant = db.query(ConversationParticipant).filter(
        ConversationParticipant.conversation_id == message.conversation_id,
        ConversationParticipant.user_id == current_user.id,
        ConversationParticipant.is_active
    ).first()
    
    if not participant:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get reactions
    reactions = db.query(MessageReaction).filter(
        MessageReaction.message_id == message_id
    ).all()
    
    reaction_counts = {}
    for reaction in reactions:
        if reaction.emoji not in reaction_counts:
            reaction_counts[reaction.emoji] = []
        reaction_counts[reaction.emoji].append({
            "user_id": reaction.user_id,
            "username": reaction.user.username
        })
    
    return reaction_counts
